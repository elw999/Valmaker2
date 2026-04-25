import nodemailer from "nodemailer";

export function getEmailTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("GMAIL_USER 或 GMAIL_APP_PASSWORD 未設定");

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

export function getSenderAddress(): string {
  return `Valmaker <${process.env.GMAIL_USER}>`;
}
