/**
 * DEMO_MODE=true turns a server into a public demo: codes for email and phone are shown in the app, and the identity check goes to
 * our own simulated page where anyone presses Approve or Deny. Nothing in it proves who someone is, so use it only with made-up
 * data and never with real people. The rest of production (secrets, encryption keys, staff 2-step sign-in) still applies, and
 * the API says so loudly every time it starts.
 */
export const isDemo = () => process.env.DEMO_MODE === 'true';

/**
 * Sample content: the made-up people of the seed and demo scripts (scripts/seed.ts and the demo:* scripts use @demo.local; the
 * load test @load.test). Their activities, trips and profiles carry `sample: true`, so the app can label them "Sample" and
 * nobody mistakes them for real people. Nothing is stored for it: the address says it.
 */
export const isSampleEmail = (email?: string | null) => !!email && /@(demo\.local|load\.test)$/i.test(email.trim());

/** Development and demos may use the simulated pieces; a real production server may not. */
export const allowsSimulated = () => process.env.NODE_ENV !== 'production' || isDemo();
