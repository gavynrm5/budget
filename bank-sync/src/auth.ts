import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Only the app's owner may use this worker. Every request carries the
 * Firebase ID token of the signed-in user; it must be a valid Google-signed
 * token for this Firebase project, and its user id must be the owner's.
 */

// The same keys Google publishes as X.509 certs, in JWK form so WebCrypto can use them.
const GOOGLE_KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

export class AuthError extends Error {}

export async function requireOwner(request: Request, projectId: string, ownerUid: string): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new AuthError("Missing sign-in token.");
  let payload;
  try {
    ({ payload } = await jwtVerify(token, GOOGLE_KEYS, {
      algorithms: ["RS256"],
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId
    }));
  } catch {
    throw new AuthError("Sign-in token is invalid or expired.");
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload.sub || typeof payload.auth_time !== "number" || payload.auth_time > now + 60) throw new AuthError("Sign-in token is invalid.");
  if (payload.sub !== ownerUid) throw new AuthError("This account isn't allowed to use bank sync.");
  return payload.sub;
}
