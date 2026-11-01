const path = require('node:path');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const input = process.argv[2];
if (!input) throw Error('Provide the approved Forecast engine source image');
sharp(input).extract({ left: 0, top: 0, width: 1024, height: 1130 })
  .resize(480, 530).webp({ quality: 83 })
  .toFile(path.resolve(__dirname, '../assets/images/korascoreai-forecast-engine.webp'))
  .then(() => console.log('Built the approved reference engine image without upscaling.'));
