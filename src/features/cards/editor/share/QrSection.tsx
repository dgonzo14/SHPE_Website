import { useMemo, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/useToast";
import { errorText } from "@/lib/errors";
import { cardUrl } from "@/services/cards";
import type { CardTheme } from "../../model";
import { downloadBlob, qrPngBlob, qrSvg } from "../../qr";
import { resolveTheme } from "../../themes";
import { OptionGroup } from "../design/parts";
import { PLAIN_QR_COLORS, themedQrColors, type QrColors } from "./qrColors";

type QrStyle = "theme" | "plain";

/** Pixels per module for the PNG: about 700 px square, sharp enough to print a poster. */
const PNG_SCALE = 16;

function ColorPairSwatch({ colors }: { colors: QrColors }) {
  return (
    <span className="flex h-8 w-16 border border-shpe-rule" style={{ backgroundColor: colors.bg }}>
      <span className="m-auto grid grid-cols-3 gap-0.5">
        {[1, 0, 1, 0, 1, 0, 1, 1, 0].map((on, i) => (
          <span key={i} className="block size-1.5" style={{ backgroundColor: on ? colors.fg : "transparent" }} />
        ))}
      </span>
    </span>
  );
}

/**
 * The card's QR code, drawn in the browser from the member's own colours.
 *
 * It encodes the ?src=qr address so Insights can count scans separately from
 * taps and shared links. The SVG on screen is shown through an <img> data URL
 * (the CSP allows data: images), so the generated markup never touches the DOM
 * as HTML.
 */
export function QrSection({
  handle,
  displayName,
  theme,
}: {
  handle: string;
  displayName: string;
  theme: CardTheme;
}) {
  const toast = useToast();
  const [style, setStyle] = useState<QrStyle>("theme");
  const [savingPng, setSavingPng] = useState(false);

  const url = cardUrl(handle, "qr");
  const themed = useMemo(() => themedQrColors(resolveTheme(theme)), [theme]);
  const colors = style === "theme" ? themed : PLAIN_QR_COLORS;
  const themeFellBack = themed.fg === PLAIN_QR_COLORS.fg && themed.bg === PLAIN_QR_COLORS.bg;

  const svg = useMemo(
    () => qrSvg(url, { fg: colors.fg, bg: colors.bg, margin: 4, title: `QR code for ${displayName}'s WashU SHPE card` }),
    [url, colors.fg, colors.bg, displayName],
  );
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const downloadSvg = () => {
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${handle}-qr.svg`);
  };

  const downloadPng = async () => {
    setSavingPng(true);
    try {
      const blob = await qrPngBlob(url, { fg: colors.fg, bg: colors.bg, scale: PNG_SCALE, margin: 4 });
      downloadBlob(blob, `${handle}-qr.png`);
    } catch (error) {
      toast.error("Couldn't make the PNG", error instanceof Error ? error.message : errorText(error));
    } finally {
      setSavingPng(false);
    }
  };

  return (
    <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
      <div className="mx-auto w-full max-w-56 border border-shpe-rule bg-white p-2 sm:mx-0">
        <img
          src={src}
          alt={`QR code that opens your card at ${url}`}
          width={224}
          height={224}
          className="block aspect-square h-auto w-full"
        />
      </div>

      <div className="min-w-0 space-y-4">
        <OptionGroup<QrStyle>
          legend="Colors"
          value={style}
          onChange={setStyle}
          columns="grid-cols-2"
          hint={
            themeFellBack
              ? "Your card's colors don't have enough contrast to scan reliably, so both options are black and white."
              : undefined
          }
          options={[
            { value: "theme", label: "Card colors", preview: <ColorPairSwatch colors={themed} /> },
            { value: "plain", label: "Black and white", preview: <ColorPairSwatch colors={PLAIN_QR_COLORS} /> },
          ]}
        />

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void downloadPng()} loading={savingPng}>
            {!savingPng && <Download className="h-4 w-4" aria-hidden="true" />}
            Download PNG
          </Button>
          <Button variant="subtle" onClick={downloadSvg}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download SVG
          </Button>
        </div>

        <p className="text-sm text-gray-600">
          PNG for slides and social posts; SVG for anything printed, since it stays sharp at any
          size. Print it at least 2 cm (¾ in) wide and keep the light border around it.
        </p>
        <p className="break-all text-xs text-gray-600">
          Scanning opens <span className="font-mono">{url}</span>. The <span className="font-mono">?src=qr</span>{" "}
          lets Insights count scans.
        </p>
      </div>
    </div>
  );
}
