const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sharpPath = process.env.SHARP_MODULE || 'sharp';
const sharp = require(sharpPath);
const logo = fs.readFileSync(path.join(root, 'assets/images/korafabor-logo.svg'));
(async () => {
  const foreground = await sharp(logo).resize({ width: 980 }).png().toBuffer();
  await sharp(logo).png().toFile(path.join(root, 'assets/images/logo.png'));
  await sharp(logo).resize({ width: 500 }).webp({ quality: 90 }).toFile(path.join(root, 'assets/images/logo-header.webp'));
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: '#18262c' } })
    .composite([{ input: foreground, gravity: 'center' }]).png().toFile(path.join(root, 'assets/images/korafabor-social.png'));
  await sharp(logo).extract({ left: 6, top: 0, width: 122, height: 144 }).resize({ width: 64, height: 64, fit: 'contain', background: '#00000000' }).png().toFile(path.join(root, 'assets/images/korafabor-favicon.png'));
  console.log('New-brand social image and favicon built.');
})();
