import Image from "next/image";

export const PH7_LOGO_URL = "https://www.ph7.health/images/Group-13739.svg";

/** Official artwork, fetched unchanged from the single canonical source. */
export function Logo() {
  return <Image src={PH7_LOGO_URL} alt="pH7" width={104} height={59}
    className="ph7-logo" unoptimized loading="eager" />;
}
