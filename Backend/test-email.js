
require("dotenv").config();

const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD
  }
});

async function testEmail() {
  try {
    console.log("Connecting to Gmail SMTP...");

    await transporter.verify();

    console.log("SMTP connection successful.");

    const result = await transporter.sendMail({
      from: `"Hippo House Malindi" <${process.env.EMAIL_USER}>`,
      to: process.env.OWNER_EMAIL,
      subject: "Hippo House - Email Test",
      text: "This is a test email from the Hippo House Malindi backend."
    });

    console.log("Email accepted:", result.messageId);
  } catch (error) {
    console.error("Email test failed:");
    console.error("Code:", error.code);
    console.error("Message:", error.message);
    console.error("Reason:", error.reason);
  }
}

testEmail();
