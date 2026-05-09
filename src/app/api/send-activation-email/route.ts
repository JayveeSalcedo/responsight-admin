import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import crypto from 'crypto'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function createTransporter() {
  // SMTP transport for transactional emails.
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT ?? 465),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
}

export async function POST(req: NextRequest) {
  try {
    const { userId, email, firstName, tempPassword } = await req.json()

    if (!userId || !email || !firstName || !tempPassword) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // ── Generate a secure activation token ──────────────────────────────────
    const token     = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000) // 72 hours

    // ── Store token in DB ────────────────────────────────────────────────────
    const { error: tokenErr } = await supabaseAdmin
      .from('activation_tokens')
      .upsert({ user_id: userId, token, expires_at: expiresAt.toISOString() }, { onConflict: 'user_id' })

    if (tokenErr) {
      console.error('Token insert error:', tokenErr)
      return NextResponse.json({ error: 'Failed to create activation token' }, { status: 500 })
    }

    // ── Build activation URL ─────────────────────────────────────────────────
    const baseUrl       = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').trim().replace(/\/+$/, '')
    const activationUrl = `${baseUrl}/activate?token=${token}`

    // ── Send email ───────────────────────────────────────────────────────────
    const transporter = createTransporter()

    await transporter.sendMail({
      from:    process.env.SMTP_FROM,
      to:      email,
      subject: 'Your ResponSight Responder Account is Ready',
      html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Activate Your Account</title>
</head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:16px;border:1px solid #2a2a2a;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#3b5bdb,#1c3faa);padding:32px 40px;text-align:center;">
              <div style="font-size:28px;margin-bottom:8px;">🛡️</div>
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">ResponSight</h1>
              <p style="margin:6px 0 0;color:#a5b4fc;font-size:13px;">Emergency Response Management System</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 8px;color:#a0a0a0;font-size:13px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Welcome aboard</p>
              <h2 style="margin:0 0 20px;color:#ffffff;font-size:20px;font-weight:700;">Hello, ${firstName}!</h2>

              <p style="margin:0 0 24px;color:#b0b0b0;font-size:14px;line-height:1.7;">
                An administrator has created a <strong style="color:#e0e0e0;">ResponSight responder account</strong> for you.
                Click the button below to activate your account and get started.
              </p>

              <!-- Credentials box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #2a2a2a;border-radius:10px;margin-bottom:28px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 12px;color:#a0a0a0;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Your Login Credentials</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;color:#888;font-size:13px;width:100px;">Email</td>
                        <td style="padding:6px 0;color:#e0e0e0;font-size:13px;font-weight:600;">${email}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#888;font-size:13px;">Password</td>
                        <td style="padding:6px 0;">
                          <code style="background:#1e1e1e;border:1px solid #333;border-radius:6px;padding:4px 10px;color:#a5b4fc;font-size:13px;font-family:monospace;letter-spacing:1px;">${tempPassword}</code>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Activate button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center">
                    <a href="${activationUrl}"
                       style="display:inline-block;background:linear-gradient(135deg,#3b5bdb,#1c3faa);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 40px;border-radius:10px;letter-spacing:0.2px;">
                      ✅ &nbsp; Activate My Account
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Note -->
              <div style="background:#1e1e1e;border-left:3px solid #3b5bdb;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:24px;">
                <p style="margin:0;color:#a0a0a0;font-size:13px;line-height:1.6;">
                  ⏰ This activation link expires in <strong style="color:#e0e0e0;">72 hours</strong>.
                  After activating, please change your password in the app's Security Settings.
                </p>
              </div>

              <p style="margin:0;color:#666;font-size:12px;line-height:1.6;">
                If the button doesn't work, copy and paste this link into your browser:<br/>
                <a href="${activationUrl}" style="color:#6b83f0;word-break:break-all;">${activationUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#111;padding:20px 40px;border-top:1px solid #2a2a2a;">
              <p style="margin:0;color:#555;font-size:11px;text-align:center;">
                This email was sent by the ResponSight admin panel. If you did not expect this, please ignore it.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `.trim(),
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('send-activation-email error:', err)
    return NextResponse.json({ error: err.message ?? 'Failed to send email' }, { status: 500 })
  }
}
