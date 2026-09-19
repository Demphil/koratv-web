import { isIP } from 'node:net';
import proxyaddr from 'proxy-addr';

export function createClientIpResolver(trustedCloudflareProxies = []) {
  const trusted = trustedCloudflareProxies.length ? proxyaddr.compile(trustedCloudflareProxies) : () => false;
  return (req) => {
    const header = req.headers['cf-connecting-ip'];
    const value = trusted(req.socket.remoteAddress) && typeof header === 'string' ? header : req.ip;
    if (!isIP(value)) throw new Error('Invalid client IP');
    const normalized = value.replace(/^::ffff:/i, '');
    return isIP(normalized) === 6 ? new URL(`http://[${normalized}]`).hostname : normalized;
  };
}
