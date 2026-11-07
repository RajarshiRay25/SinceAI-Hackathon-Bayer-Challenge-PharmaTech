// All calls to the Python backend live here.
// In development Vite forwards /api to http://127.0.0.1:8000 (see vite.config.js).
// In production FastAPI serves this app and the API from the same address.

async function request(path, { headers, ...options } = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...headers },
    ...options,
  });
  if (!res.ok) {
    // FastAPI puts a readable reason in `detail`; fall back to the status code
    const detail = await res.json().then((j) => j.detail, () => null);
    const err = new Error(typeof detail === "string" ? detail : `API ${path} returned ${res.status}`);
    err.status = res.status; // 401 = access code needed, 429 = question limit reached
    throw err;
  }
  return res.json();
}

export const getMeta = () => request("/meta");
export const getQuality = () => request("/quality");
export const getDashboard = (filters, signal) =>
  request("/dashboard", { method: "POST", body: JSON.stringify(filters), signal });

// Bayesian network (What-if explorer)
export const getBayesGraph = () => request("/bayes/graph");
export const queryBayes = (evidence, signal) =>
  request("/bayes/query", { method: "POST", body: JSON.stringify({ target: "covid", evidence }), signal });
export const rankBayes = (evidence, signal) =>
  request("/bayes/influence", { method: "POST", body: JSON.stringify({ evidence }), signal });

// Chatbot: the question goes to the backend, which calls the LLM; the API key never reaches the browser.
export const getChatStatus = () => request("/chat/status");
export const sendChat = (messages, filters, tab, signal, accessCode) =>
  request("/chat", {
    method: "POST", body: JSON.stringify({ messages, filters, tab }), signal,
    headers: accessCode ? { "X-Access-Code": accessCode } : undefined,
  });
