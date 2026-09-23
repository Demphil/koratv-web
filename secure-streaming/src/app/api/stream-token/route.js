import { z } from "zod";
import crypto from "crypto";
import { getActiveChannelByName } from "../../../lib/channelStore";
import { corsHeaders, getClientIp, getSessionId, isApprovedOrigin, signStreamToken } from "../../../lib/security";

const schema = z.object({
  channelName: z.string().min(1).max(160),
  embed: z.boolean().optional(),
  parentOrigin: z.string().max(300).optional(),
  humanFingerprint: z.string().min(1, "Missing fingerprint") 
});

function encryptPayload(data) {
  const key = crypto.createHash('sha256').update(String(process.env.AES_ENCRYPTION_KEY || 'fallback-key')).digest();
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
}

export async function OPTIONS(request) {
  return new Response(null, { headers: corsHeaders(request) });
}

export async function POST(request) {
  try {
    const parsed = schema.parse(await request.json());
    
    if (parsed.embed && !isApprovedOrigin(parsed.parentOrigin || "")) {
      return Response.json({ error: "Embedding domain is not authorized." }, { status: 403, headers: corsHeaders(request) });
    }

    const channel = await getActiveChannelByName(parsed.channelName);
    if (!channel) {
      return Response.json({ error: "Channel unavailable." }, { status: 404, headers: corsHeaders(request) });
    }

    const token = signStreamToken({
      channelName: channel.name,
      ip: getClientIp(request),
      sessionId: getSessionId(request)
    });

    const rawData = {
      token,
      expiresIn: 300,
      streamUrl: `/api/stream/${encodeURIComponent(channel.name)}`
    };

    const encryptedString = encryptPayload(rawData);

    return Response.json(
      { payload: encryptedString },
      { headers: corsHeaders(request) }
    );
    
  } catch (error) {
    return Response.json({ error: "Unable to issue stream token." }, { status: 400, headers: corsHeaders(request) });
  }
}