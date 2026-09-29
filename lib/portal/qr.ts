import QRCode from "qrcode";

export async function createReferralQrSvg(referralUrl: string): Promise<string> {
  const url = new URL(referralUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Referral QR codes require an HTTP(S) URL.");
  return QRCode.toString(referralUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#3A3A3A", light: "#FFFFFF" },
  });
}
