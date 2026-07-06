import nodemailer from "nodemailer";

function buildTransportConfig(smtpConfig = {}) {
  const host = smtpConfig.smtpHost || smtpConfig.host || "business24.web-hosting.com";
  const port = Number(smtpConfig.smtpPort || smtpConfig.port || 587);
  const secure = smtpConfig.secure === true;
  const requireTLS = smtpConfig.requireTLS === true;
  const username = smtpConfig.username || smtpConfig.user || smtpConfig.email || "";
  const password = smtpConfig.password || smtpConfig.pass || "";
  const allowInvalidCerts = smtpConfig.allowInvalidCerts !== false;

  const config = {
    host,
    port,
    secure,
    requireTLS,
    auth: { user: username, pass: password },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
    pool: false,
    tls: { rejectUnauthorized: !allowInvalidCerts },
  };

  console.log("SMTP CONFIG", { host: config.host, port: config.port, secure: config.secure, requireTLS: config.requireTLS, username, hasPassword: !!password });
  return config;
}

export async function sendEmail(smtpConfig, mailOptions) {
  try {
    const transporter = nodemailer.createTransport(buildTransportConfig(smtpConfig));
    console.log("SENDING EMAIL", { to: mailOptions?.to, subject: mailOptions?.subject, attachments: mailOptions?.attachments?.length || 0 });
    const info = await transporter.sendMail(mailOptions);
    console.log("EMAIL SENT SUCCESS", { messageId: info.messageId, response: info.response });
    return info;
  } catch (err) {
    console.error("SMTP SEND ERROR FULL", { message: err.message, code: err.code, command: err.command, response: err.response, responseCode: err.responseCode });
    throw err;
  }
}

export async function testSmtp(smtpConfig) {
  try {
    const transporter = nodemailer.createTransport(buildTransportConfig(smtpConfig));
    console.log("VERIFYING SMTP...");
    await transporter.verify();
    console.log("SMTP VERIFIED");
    return { success: true };
  } catch (err) { console.error("SMTP TEST ERROR", err.message); throw err; }
}
