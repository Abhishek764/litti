/** Startup configuration checks. Fail fast on unsafe settings in production. */

export interface StartupCheck {
  errors: string[];
  warnings: string[];
}

const PLACEHOLDERS = ['change-me-to-a-long-random-string', 'changeme', 'secret', 'test'];

/** Validate environment for `npm start` (production). */
export function checkProductionConfig(env = process.env): StartupCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  const key = env.SECRET_KEY ?? '';
  if (!key) errors.push('SECRET_KEY is not set. Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  else if (key.length < 32 || PLACEHOLDERS.includes(key)) errors.push('SECRET_KEY must be at least 32 random characters (not the example value).');

  const port = Number(env.APPROVAL_SERVER_PORT || 3847);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push(`APPROVAL_SERVER_PORT "${env.APPROVAL_SERVER_PORT}" is not a valid port.`);

  if (env.PUBLIC_URL && !/^https?:\/\//.test(env.PUBLIC_URL)) errors.push('PUBLIC_URL must start with http:// or https://');

  if (!env.LITTI_API_KEY) warnings.push('LITTI_API_KEY is not set — anyone who can reach the server can submit actions.');
  else if (!env.LITTI_ADMIN_KEY) warnings.push('LITTI_ADMIN_KEY is not set — anyone with LITTI_API_KEY (including agents) can issue review links. Set a separate admin key.');
  if (env.LITTI_ALLOW_SELF_ASSERTED === 'true') warnings.push('LITTI_ALLOW_SELF_ASSERTED=true — reviewers can type any name. Use review links or LITTI_IDENTITY_HEADER in production.');
  if (env.LITTI_IDENTITY_HEADER && (env.HOST === '0.0.0.0' || env.HOST === '::')) {
    warnings.push(`LITTI_IDENTITY_HEADER is trusted — make sure only your auth proxy can reach port ${port}.`);
  }
  if (env.PUBLIC_URL?.startsWith('http://') && !/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(env.PUBLIC_URL)) {
    warnings.push('PUBLIC_URL is plain http — review links carry signed tickets; serve over https.');
  }
  return { errors, warnings };
}
