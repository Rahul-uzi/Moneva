import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * Saving a file from a Capacitor WebView.
 *
 * The browser trick of clicking a synthetic `<a download>` does nothing inside
 * an Android WebView - no DownloadListener is registered and `data:` URLs are
 * refused outright - so the old export buttons appeared to work while never
 * producing a file. On device we write to the app's Documents directory and
 * hand the file to the system share sheet instead; on the web we keep the
 * anchor, where it genuinely works.
 */
export interface ExportResult {
  /** Where the file ended up, phrased for a toast. */
  message: string;
}

export const exportJsonFile = async (
  filename: string,
  data: unknown,
  shareTitle = 'MONEVA export',
): Promise<ExportResult> => {
  const contents = JSON.stringify(data, null, 2);

  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([contents], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoke on the next tick so the download has already started.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return { message: 'Export downloaded.' };
  }

  const written = await Filesystem.writeFile({
    path: filename,
    data: contents,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  });

  try {
    await Share.share({
      title: shareTitle,
      text: filename,
      url: written.uri,
      dialogTitle: 'Save or send your export',
    });
    return { message: 'Export ready — choose where to save it.' };
  } catch {
    // The user dismissing the share sheet is not a failure: the file is saved.
    return { message: `Saved to Documents as ${filename}` };
  }
};

/**
 * Saves a binary file (e.g. .xlsx) that the API returned as an ArrayBuffer.
 *
 * Capacitor's Filesystem writes base64 when no `encoding` is given, so the
 * bytes are converted rather than being run through a text encoder, which
 * would corrupt the workbook.
 */
export const exportBinaryFile = async (
  filename: string,
  data: ArrayBuffer,
  mimeType: string,
  shareTitle = 'MONEVA export',
): Promise<ExportResult> => {
  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return { message: 'Export downloaded.' };
  }

  // Chunked so a large workbook cannot blow the call stack via spread/apply.
  const bytes = new Uint8Array(data);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const base64 = btoa(binary);

  const written = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Documents,
    recursive: true,
  });

  try {
    await Share.share({
      title: shareTitle,
      text: filename,
      url: written.uri,
      dialogTitle: 'Save or send your export',
    });
    return { message: 'Export ready — choose where to save it.' };
  } catch {
    return { message: `Saved to Documents as ${filename}` };
  }
};
