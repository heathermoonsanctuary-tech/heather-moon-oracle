// netlify/functions/send-reading.js
// ─────────────────────────────────────────────────────────────────────────────
// Heather Moon Oracle — Reading Email + Newsletter Subscription Handler
// Triggered when a user submits their email after completing a 5-card spread.
//
// Requires these env vars (set in Netlify dashboard → Site settings → Env vars):
//   RESEND_API_KEY        — from resend.com
//   RESEND_FROM_EMAIL     — e.g. reading@heathermoonsanctuary.com (verified domain)
//   ADMIN_EMAIL           — your email address for admin notifications
//   CONVERTKIT_API_KEY    — from kit.com (formerly ConvertKit) API settings
//   CONVERTKIT_FORM_ID    — the form ID from your Kit subscriber form
// ─────────────────────────────────────────────────────────────────────────────

const https = require('https');

// ── Entry point ───────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return respond(400, { error: 'Invalid JSON' });
  }

  const { email, cards, timestamp } = payload;

  // Basic validation
  if (!email || !isValidEmail(email)) {
    return respond(400, { error: 'Valid email required' });
  }
  if (!cards || !Array.isArray(cards) || cards.length === 0) {
    return respond(400, { error: 'Card data required' });
  }

  const ts = timestamp || new Date().toISOString();
  const errors = [];

  // ── 1. Send user email ──────────────────────────────────────────────────────
  try {
    await sendEmail({
      to:      email,
      from:    `Heather Moon Sanctuary <${process.env.RESEND_FROM_EMAIL}>`,
      subject: 'your reading is here, love ☽',
      html:    buildUserEmail(email, cards, ts)
    });
  } catch (err) {
    console.error('User email failed:', err.message);
    errors.push('user_email');
  }

  // ── 2. Send admin notification ──────────────────────────────────────────────
  try {
    const dateStr = new Date(ts).toLocaleDateString('en-US', {
      timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric'
    });
    await sendEmail({
      to:      process.env.ADMIN_EMAIL,
      from:    `HMO Readings <${process.env.RESEND_FROM_EMAIL}>`,
      subject: `[HMO Reading] ${email} — ${dateStr}`,
      html:    buildAdminEmail(email, cards, ts)
    });
  } catch (err) {
    console.error('Admin email failed:', err.message);
    errors.push('admin_email');
  }

  // ── 3. Subscribe to Kit (ConvertKit) newsletter ─────────────────────────────
  try {
    await subscribeToKit(email);
  } catch (err) {
    console.error('Kit subscribe failed:', err.message);
    errors.push('newsletter');
  }

  // Return success even if non-critical steps failed
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      success: true,
      warnings: errors.length > 0 ? errors : undefined
    })
  };
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function respond(status, body) {
  return {
    statusCode: status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function httpsPost(options, body) {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...options.headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function sendEmail({ to, from, subject, html }) {
  return httpsPost(
    {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }
    },
    { from, to, subject, html }
  );
}

function subscribeToKit(email) {
  return httpsPost(
    {
      hostname: 'api.convertkit.com',
      path: `/v3/forms/${process.env.CONVERTKIT_FORM_ID}/subscribe`,
      method: 'POST'
    },
    {
      api_key: process.env.CONVERTKIT_API_KEY,
      email,
      tags: ['hmo-oracle-pull'] // optional: tag them in Kit
    }
  );
}

// ── Energy colors ─────────────────────────────────────────────────────────────
function energyColor(position) {
  const map = {
    'Wanderer': '#d4af37',
    'Light Being': '#f9b8d4',
    'Demon Slayer': '#c9526a',
    'Sovereign Empath': '#9b74c4',
    'Baddie': '#ff8c42'
  };
  return map[position] || '#ff6b9d';
}

// ── USER email template ───────────────────────────────────────────────────────
function buildUserEmail(email, cards, timestamp) {
  const year = new Date(timestamp).getFullYear();

  const cardBlocks = cards.map(c => {
    const ec = energyColor(c.position);
    return `
      <div style="margin:16px 0;padding:22px 20px 22px 24px;background:#2a1260;border-radius:10px;
                  border-left:5px solid ${ec};">
        <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:3px;
                    color:${ec};text-transform:uppercase;margin-bottom:8px;">
          ${c.position}
        </div>
        <div style="font-family:Georgia,serif;font-size:16px;color:#d4581c;
                    margin-bottom:${c.attr ? '6px' : '12px'};font-style:italic;
                    line-height:1.4;">
          &ldquo;${c.text}&rdquo;
        </div>
        ${c.attr ? `
          <div style="font-family:Georgia,serif;font-size:12px;color:#f4b942;
                      margin-bottom:12px;font-style:italic;opacity:0.85;">
            &mdash; ${c.attr}
          </div>` : ''}
        <div style="font-family:Georgia,serif;font-size:14px;color:#e8d4f0;
                    line-height:1.65;font-style:italic;
                    border-top:1px solid rgba(255,255,255,0.08);padding-top:12px;">
          ${c.interpretation || ''}
        </div>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your Heather Moon Oracle Reading</title>
</head>
<body style="margin:0;padding:0;background:#07041a;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px 48px;
            font-family:Georgia,serif;background:#07041a;">

  <!-- Header -->
  <div style="text-align:center;margin-bottom:28px;">
    <div style="color:#ff6b9d;font-size:14px;letter-spacing:8px;margin-bottom:12px;">
      ✦ ☽ ✦
    </div>
    <h1 style="margin:0 0 6px;font-size:34px;font-style:italic;color:#f4b942;font-weight:normal;">
      Heather Moon Oracle
    </h1>
    <div style="color:#ff8c42;font-size:14px;letter-spacing:2px;margin-bottom:4px;">
      5-CARD HMS ENERGY SPREAD
    </div>
    <div style="color:rgba(253,242,220,0.6);font-size:13px;font-style:italic;">
      spicy but sanctuary
    </div>
  </div>

  <!-- Intro -->
  <div style="background:#1a0b3d;border-radius:12px;padding:26px;margin-bottom:20px;">
    <p style="color:#fdf2dc;font-size:16px;line-height:1.75;margin:0 0 14px;">
      love &mdash;
    </p>
    <p style="color:#fdf2dc;font-size:16px;line-height:1.75;margin:0 0 14px;">
      your reading landed. five cards from 79, out of over 2.7 billion possible
      combinations &mdash; and <em>these</em> are the ones that showed up for you.
      that&rsquo;s not random. that&rsquo;s the deck doing what it was built to do.
    </p>
    <p style="color:#fdf2dc;font-size:16px;line-height:1.75;margin:0;">
      sit with it. let it breathe. the message that&rsquo;s meant for you right now
      is already inside these five cards.
    </p>
  </div>

  <!-- Spread -->
  <div style="background:#1a0b3d;border-radius:12px;padding:26px;margin-bottom:20px;">
    <div style="text-align:center;color:#ff6b9d;font-size:11px;
                letter-spacing:4px;text-transform:uppercase;margin-bottom:16px;">
      ✦ your spread ✦
    </div>
    ${cardBlocks}
  </div>

  <!-- Newsletter note -->
  <div style="background:#1a0b3d;border-radius:12px;padding:26px;margin-bottom:20px;">
    <p style="color:#fdf2dc;font-size:15px;line-height:1.75;margin:0 0 14px;">
      you&rsquo;ve also been added to the
      <strong style="color:#f4b942;">Heather Moon Sanctuary</strong>
      weekly newsletter &mdash; every Sunday, a real sky report, a live collective
      pull, and the Five Energies framework woven through all of it. no fluff.
      no performance. just the actual cosmic weather and what it means for you.
    </p>
    <p style="color:#fdf2dc;font-size:15px;line-height:1.75;margin:0;">
      a deeper, personalized interpretation of your spread may find its way to you
      too. the deck already knows what you needed to hear. i&rsquo;m just going to
      help you hear it louder.
    </p>
  </div>

  <!-- Closer -->
  <div style="text-align:center;padding:24px 0 8px;">
    <div style="font-family:Georgia,serif;font-style:italic;font-size:30px;
                color:#ff8c42;margin-bottom:12px;">
      the cape fits.
    </div>
    <div style="color:#fdf2dc;font-size:14px;margin-bottom:6px;">
      &mdash; Heather 💗
    </div>
    <div style="color:rgba(253,242,220,0.5);font-size:12px;font-style:italic;
                margin-bottom:24px;">
      Heather Moon Sanctuary &mdash; spicy but sanctuary.
    </div>
    <div style="border-top:1px solid rgba(255,107,157,0.2);padding-top:20px;">
      <div style="color:rgba(253,242,220,0.3);font-size:11px;font-style:italic;
                  line-height:1.6;">
        &copy; ${year} Heather Moon Sanctuary &middot; Heather Green
        &middot; All rights reserved<br>
        Heather Moon Oracle &mdash; 79 cards &middot; written by hand
      </div>
    </div>
  </div>

</div>
</body>
</html>`;
}

// ── ADMIN email template ──────────────────────────────────────────────────────
function buildAdminEmail(email, cards, timestamp) {
  const dateStr = new Date(timestamp).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short', month: 'short', day: 'numeric',
    year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const cardRows = cards.map((c, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#ffffff'};">
      <td style="padding:10px 12px;border:1px solid #ddd;font-weight:bold;
                 white-space:nowrap;vertical-align:top;">
        ${i + 1}. ${c.position}
      </td>
      <td style="padding:10px 12px;border:1px solid #ddd;vertical-align:top;">
        <strong>#${c.num} &mdash; ${c.cat}</strong><br>
        <em style="color:#a8410f;">&ldquo;${c.text}&rdquo;</em><br>
        ${c.attr ? `<span style="color:#7b5c00;font-size:12px;">&mdash; ${c.attr}</span><br>` : ''}
        <span style="color:#555;font-size:13px;">${c.interpretation || ''}</span>
      </td>
    </tr>`
  ).join('');

  const aiPrompt = cards.map((c, i) =>
    `${i + 1}. [${c.position}] Card #${c.num}: "${c.text}"${c.attr ? ` (${c.attr})` : ''}`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>HMO Reading — Admin</title>
</head>
<body style="margin:0;padding:20px;background:#f4f4f4;font-family:Arial,sans-serif;">
<div style="max-width:700px;margin:0 auto;background:#fff;border-radius:8px;
            overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">

  <!-- Header -->
  <div style="background:#1a0b3d;padding:20px 24px;">
    <div style="color:#ff6b9d;font-size:18px;margin-bottom:4px;">
      🌙 HMO Reading Notification
    </div>
    <div style="color:rgba(253,242,220,0.7);font-size:13px;">
      Heather Moon Oracle &mdash; 5-Card HMS Energy Spread
    </div>
  </div>

  <div style="padding:24px;">

    <!-- Meta -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="padding:10px 12px;border:1px solid #ddd;background:#f0e8ff;
                   font-weight:bold;width:140px;">User Email</td>
        <td style="padding:10px 12px;border:1px solid #ddd;">
          <a href="mailto:${email}">${email}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 12px;border:1px solid #ddd;background:#f0e8ff;
                   font-weight:bold;">Timestamp</td>
        <td style="padding:10px 12px;border:1px solid #ddd;">${dateStr} MT</td>
      </tr>
    </table>

    <!-- Card spread -->
    <h3 style="color:#2d1b69;margin:0 0 12px;font-size:15px;
               text-transform:uppercase;letter-spacing:1px;">
      Card Spread
    </h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <thead>
        <tr style="background:#2d1b69;color:#fff;">
          <th style="padding:10px 12px;border:1px solid #ddd;text-align:left;
                     white-space:nowrap;">Position</th>
          <th style="padding:10px 12px;border:1px solid #ddd;text-align:left;">
            Card &amp; Interpretation
          </th>
        </tr>
      </thead>
      <tbody>${cardRows}</tbody>
    </table>

    <!-- AI prompt box -->
    <div style="background:#fff8e1;border:1px solid #f4b942;border-left:5px solid #f4b942;
                border-radius:4px;padding:16px;margin-bottom:24px;">
      <div style="font-weight:bold;color:#7b5c00;margin-bottom:10px;font-size:14px;">
        ✨ Personalized Interpretation Prompt
      </div>
      <p style="color:#555;font-size:13px;margin:0 0 10px;line-height:1.5;">
        Paste this into Claude or ChatGPT to generate a personalized reading for
        this subscriber:
      </p>
      <div style="background:#fff;border:1px solid #ddd;border-radius:4px;
                  padding:14px;font-size:13px;color:#333;">
        <strong>Context:</strong> You are reading for a subscriber of Heather Moon
        Sanctuary. The brand voice is &ldquo;spicy but sanctuary&rdquo; &mdash; direct,
        warm, spiritually grounded, occasionally spicy. The Heather Moon Oracle is a
        79-card handwritten deck covering biofield science, scripture, spiritual
        warfare, shadow work, identity, money, calling, motherhood, and joy.
        <br><br>
        <strong>Their 5-card HMS Energy Spread:</strong><br>
        <pre style="margin:10px 0 0;font-size:12px;white-space:pre-wrap;
                    line-height:1.6;">${aiPrompt}</pre>
        <br>
        Write a personalized 3-4 paragraph interpretation. Speak directly in second
        person (&ldquo;you&rdquo;). Find the through-line across all five energies.
        Close with &ldquo;the cape fits.&rdquo;
      </div>
    </div>

    <!-- Quick reply note -->
    <div style="background:#f0f8ff;border:1px solid #b8d4f0;border-radius:4px;
                padding:14px;font-size:13px;color:#333;">
      <strong>Reply directly to the user:</strong>
      <a href="mailto:${email}?subject=your%20personal%20reading%20☽" 
         style="color:#2d1b69;margin-left:8px;">
        ${email}
      </a>
    </div>

  </div>
</div>
</body>
</html>`;
}
