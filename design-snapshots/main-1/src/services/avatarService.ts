import { apiClient } from './apiClient';
import type { User } from '../types/api';

/** Longest edge of the stored avatar. Keeps the data URL small enough to sit in the DB row. */
const AVATAR_SIZE = 256;
const JPEG_QUALITY = 0.82;

/**
 * Downscales and centre-crops a picked image to a square JPEG data URL.
 * Done on the client so the API never receives multi-megabyte camera photos.
 */
export const fileToAvatarDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please choose an image file.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That image could not be decoded.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Image processing is unavailable on this device.'));
          return;
        }

        // Centre-crop the largest square that fits, then scale it down.
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });

export const uploadAvatar = async (dataUrl: string): Promise<User> => {
  const res = await apiClient.put<User>('/profile/avatar', { avatar_data_url: dataUrl });
  return res.data;
};

export const deleteAvatar = async (): Promise<User> => {
  const res = await apiClient.delete<User>('/profile/avatar');
  return res.data;
};
