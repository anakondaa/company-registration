require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: [
    'https://felixclarke.com',
    'https://www.felixclarke.com',
    'https://aifuturetech.squarespace.com',
    'https://www.aifuturetech.squarespace.com'
  ]
}));
app.use(express.json());
app.use('/stripe-webhook', express.raw({type: 'application/json'}));

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.post('/check-name', async (req, res) => {
  const { companyName } = req.body;

  if (!companyName) {
    return res.status(400).json({ error: 'Company name is required' });
  }

  const encodedKey = Buffer.from(`${process.env.COMPANIES_HOUSE_API_KEY}:`).toString('base64');
  const searchUrl = `https://api.companieshouse.gov.uk/search/companies?q=${encodeURIComponent(companyName)}`;

  try {
    const response = await axios.get(searchUrl, {
      headers: {
        'Authorization': `Basic ${encodedKey}`
      }
    });

    const normalizedSearchName = companyName.trim().toUpperCase().replace(/\s+/g, ' ');
    
    const exactMatch = response.data.items.find(company => {
      const companyTitle = company.title.toUpperCase().replace(/\s+/g, ' ');
      return companyTitle === normalizedSearchName || 
             companyTitle === `${normalizedSearchName} LIMITED` ||
             companyTitle === `${normalizedSearchName} LTD`;
    });

    if (exactMatch) {
      const suggestions = [
        `${companyName} UK`,
        `${companyName} Solutions`,
        `${companyName} Group`,
        `${companyName} Holdings`,
        `${companyName} Services`
      ];
      res.json({ available: false, suggestions: suggestions });
    } else {
      res.json({ available: true, suggestions: [] });
    }
  } catch (error) {
    console.error('Error checking company name:', error);
    res.status(500).json({ error: 'Could not check company name.' });
  }
});

app.post('/create-payment-intent', async (req, res) => {
  const amountInPence = 11400;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInPence,
      currency: 'gbp',
      automatic_payment_methods: { enabled: true },
    });

    res.send({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    console.error("Stripe Error:", error);
    res.status(500).json({ error: 'Could not create payment intent.' });
  }
});

async function sendSubmissionEmail(data) {
  const emailContent = `
    NEW UK COMPANY REGISTRATION
    ===========================

    COMPANY DETAILS:
    - Company Name: ${data.companyName}
    - Company Type: ${data.companyType || 'Private company limited by shares'}
    - SIC Codes: ${data.sic_codes || 'N/A'}
    
    REGISTERED OFFICE ADDRESS:
    ${data.address_line1 || 'N/A'}
    ${data.address_line2 || ''}
    ${data.city || 'N/A'}, ${data.county || ''}
    ${data.postcode || 'N/A'}
    ${data.country || 'United Kingdom'}

    DIRECTORS:
    ${data.directors ? JSON.stringify(data.directors, null, 2) : 'N/A'}

    SHAREHOLDERS:
    ${data.shareholders ? JSON.stringify(data.shareholders, null, 2) : 'N/A'}
    Total Share Capital: ${data.total_share_capital || 'N/A'}

    PERSONS WITH SIGNIFICANT CONTROL (PSC):
    ${data.pscs ? JSON.stringify(data.pscs, null, 2) : 'N/A'}

    CONTACT INFORMATION:
    - Email: ${data.contact_email || data.email}
    - Phone: ${data.contact_phone || 'N/A'}

    ARTICLES OF ASSOCIATION:
    ${data.articles_type || 'Model Articles'}
    
    PAYMENT:
    - Amount: £114.00
    - Payment ID: ${data.payment_id || 'N/A'}
    
    Submitted at: ${new Date().toISOString()}
  `;

  try {
    const response = await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { 
        name: 'Company Registration',
        email: 'anduelhoti59@gmail.com'
      },
      to: [
        { email: 'info@felixclarke.com' },
        { email: 'anduelhoti59@gmail.com' }
      ],
      subject: `New Company Registration: ${data.companyName}`,
      textContent: emailContent
    }, {
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    console.log('Email sent successfully via Brevo API. Message ID:', response.data.messageId);
  } catch (error) {
    console.error('Email sending error:', error.response?.data || error.message);
    throw error;
  }
}


// SIC Code Search Endpoint
const sicCodes = require('./sic-codes.json');

app.get('/api/sic-codes/search', (req, res) => {
  const query = req.query.q?.toLowerCase() || '';
  
  if (!query || query.length < 2) {
    return res.json([]);
  }

  const results = sicCodes
    .filter(sic => 
      sic.code.includes(query) || 
      sic.description.toLowerCase().includes(query)
    )
    .slice(0, 15);

  res.json(results);
});


app.post('/submit-registration', async (req, res) => {
  const data = req.body;

  try {
    const registration = {
      ...data,
      timestamp: new Date().toISOString()
    };
    
    fs.appendFileSync('./registrations.json', JSON.stringify(registration) + '\n');
    console.log('Registration saved to file');

    await sendSubmissionEmail(data);

    res.json({ success: true, message: 'Registration submitted successfully' });
  } catch (error) {
    console.error('Error submitting registration:', error);
    res.status(500).json({ error: 'Could not submit registration' });
  }
});



app.post('/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    console.log(`Payment for £${paymentIntent.amount / 100} succeeded!`);
  }

  res.json({received: true});
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
