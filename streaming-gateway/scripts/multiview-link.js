import jwt from 'jsonwebtoken';
const token = jwt.sign({}, process.env.JWT_SECRET, { algorithm: 'HS256', issuer: 'koratv-gateway', audience: 'multiview-admin', expiresIn: '24h' });
console.log(`${process.env.PLAYER_ORIGIN || 'https://fabor.sbs'}/multiview.html#${token}`);
