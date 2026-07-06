import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { syncAllActiveAccounts, syncOneAccount } from "./services/syncService.js";
import { sendEmail, testSmtp } from "./services/smtpService.js";
import { fetchEmails } from "./services/emailService.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.MAIL_WORKER_TOKEN || "";

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

function requireWorkerToken(req, res, next) {
  if (req.path === "/" || req.path === "/health") return next();

  if (!TOKEN) {
    return res.status(500).json({ success: false, error: "MAIL_WORKER_TOKEN is not configured" });
  }

  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  return next();
}

app.use(requireWorkerToken);

app.get("/", (req, res) => {
  res.json({ ok: true, service: "mailflow-worker", version: "2.0.0", status: "running", timestamp: new Date().toISOString() });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "mailflow-worker", version: "2.0.0", status: "healthy", uptimeSeconds: Math.round(process.uptime()), timestamp: new Date().toISOString() });
});

app.post("/mail/test", async (req, res) => {
  try {
    const account = normalizeAccountPayload(req.body || {});

    await fetchEmails({ account, folder: "INBOX", limit: 1, include_attachments: false, attachments_metadata_only: true });

    await testSmtp({
      smtpHost: account.smtp_host,
      smtpPort: account.smtp_port,
      username: account.username || account.email,
      password: account.password,
      secure: account.smtp_secure,
      requireTLS: account.smtp_require_tls,
      allowInvalidCerts: account.allow_invalid_certs,
    });

    res.json({ success: true, message: "Connection successful" });
  } catch (err) {
    console.error("TEST ACCOUNT ERROR", err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post("/test-account", (req, res) => {
  req.url = "/mail/test";
  app.handle(req, res);
});

app.post("/fetch-emails", async (req, res) => {
  try {
    const body = req.body || {};

    if (body.account_id) {
      const result = await syncOneAccount(body.account_id, { folder: body.folder || "INBOX", limit: body.limit || 50, full_resync: body.full_resync === true });
      return res.json({ success: true, ...result });
    }

    const result = await fetchEmails(body);
    return res.json({ success: true, emails: result?.emails || [], count: result?.emails?.length || 0 });
  } catch (err) {
    console.error("FETCH EMAILS ERROR", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/mail/sync", (req, res) => {
  req.url = "/fetch-emails";
  app.handle(req, res);
});

app.post("/send-email", async (req, res) => {
  try {
    const body = req.body || {};

    const smtpConfig = body.smtpConfig || {
      smtpHost: body.smtp?.host || body.smtp_host,
      smtpPort: body.smtp?.port || body.smtp_port,
      username: body.username || body.email,
      password: body.password,
      secure: body.smtp?.secure ?? body.smtp_secure,
      requireTLS: body.smtp_require_tls,
      allowInvalidCerts: body.allow_invalid_certs,
    };

    const mailOptions = {
      from: body.from,
      to: body.to,
      cc: body.cc || [],
      bcc: body.bcc || [],
      subject: body.subject || "",
      text: body.text || body.body_text || "",
      html: body.html || body.body_html || "",
      attachments: normalizeAttachments(body.attachments || []),
      inReplyTo: body.in_reply_to || body.inReplyTo,
      references: body.references,
    };

    const info = await sendEmail(smtpConfig, mailOptions);
    res.json({ success: true, messageId: info.messageId, message_id: info.messageId, response: info.response });
  } catch (err) {
    console.error("SEND EMAIL ERROR", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/mail/send", (req, res) => {
  req.url = "/send-email";
  app.handle(req, res);
});

app.post("/save-account", (req, res) => {
  res.status(200).json({ success: true, message: "Account saving is handled by Supabase, not the mail worker." });
});

app.post("/sync-all", async (req, res) => {
  try {
    const result = await syncAllActiveAccounts();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("SYNC ALL ERROR", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

setInterval(syncAllActiveAccounts, 30000);
syncAllActiveAccounts();

app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.path}` });
});

app.listen(PORT, () => {
  console.log(`MailFlow Worker v2 running on port ${PORT}`);
});

function normalizeAccountPayload(body = {}) {
  const imap = body.imap || {};
  const smtp = body.smtp || {};
  const email = body.email || body.username;

  return {
    id: body.account_id || body.id,
    email,
    username: body.username || email,
    password: body.password,
    imap_host: body.imap_host || imap.host,
    imap_port: Number(body.imap_port || imap.port || 993),
    smtp_host: body.smtp_host || smtp.host,
    smtp_port: Number(body.smtp_port || smtp.port || 587),
    smtp_secure: smtp.secure ?? body.smtp_secure ?? false,
    smtp_require_tls: body.smtp_require_tls ?? true,
    allow_invalid_certs: body.allow_invalid_certs === true,
  };
}

function normalizeAttachments(attachments = []) {
  return attachments.map((a) => ({ filename: a.filename, content: a.content, encoding: a.encoding || "base64", contentType: a.contentType || a.content_type }));
}
