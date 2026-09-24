/**
 * Shrinks a photo so it can be stored with the rest of the data for free
 * (Firestore documents max out at 1 MB). Scales the long side down to 900px
 * and saves as JPEG, lowering quality until it fits.
 */
const MAX_SIDE = 900;
const MAX_CHARS = 450_000; // about 330 KB of image, well under the document limit

export async function shrinkImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't read that image. Try a JPEG or PNG."));
      el.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    let w = Math.max(1, Math.round(img.naturalWidth * scale));
    let h = Math.max(1, Math.round(img.naturalHeight * scale));
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser can't resize images.");
      ctx.fillStyle = "#ffffff"; // transparent PNGs get a white background as JPEG
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const out = canvas.toDataURL("image/jpeg", attempt < 3 ? 0.8 - attempt * 0.15 : 0.6);
      if (out.length <= MAX_CHARS) return out;
      if (attempt >= 2) {
        w = Math.round(w * 0.75);
        h = Math.round(h * 0.75);
      }
    }
    throw new Error("That image is too large even after shrinking. Try a smaller one or a screenshot.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
