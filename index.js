const express = require("express");
const cors = require("cors");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use((req, res, next) => {
  console.log("INCOMING", req.method, req.path);
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: "https://tools.daytradinguni.com",
    methods: ["GET", "POST", "OPTIONS"],
  })
);

const GHL_BASE_URL = "https://services.leadconnectorhq.com";

function getGhlClient(ghlToken) {
  return axios.create({
    baseURL: GHL_BASE_URL,
    headers: {
      Authorization: `Bearer ${ghlToken}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    },
    timeout: 15000,
  });
}

async function lookupContactByEmail(client, email, locationId) {
  console.log("GHL_REQUEST_URL", `${GHL_BASE_URL}/contacts/search`);
  const response = await client.post("/contacts/search", {
    locationId,
    query: email,
    page: 1,
    pageLimit: 20,
  });
  const contacts =
    response.data && response.data.contacts && Array.isArray(response.data.contacts)
      ? response.data.contacts
      : [];
  const normalizedEmail = String(email || "").toLowerCase();
  const match =
    contacts.find(
      (contact) => String(contact && contact.email ? contact.email : "").toLowerCase() === normalizedEmail
    ) || null;
  if (!match || !match.id) {
    return null;
  }
  return { id: match.id };
}

async function createContact(client, payload) {
  console.log("GHL_REQUEST_URL", `${GHL_BASE_URL}/contacts/`);
  const response = await client.post("/contacts/", payload);
  return response.data;
}

async function updateContact(client, contactId, payload) {
  console.log("GHL_REQUEST_URL", `${GHL_BASE_URL}/contacts/${contactId}`);
  const { locationId, ...safePayload } = payload || {};
  const response = await client.put(`/contacts/${contactId}`, safePayload);
  return response.data;
}

async function addTagToContact(client, contactId, tag) {
  console.log("GHL_REQUEST_URL", `${GHL_BASE_URL}/contacts/${contactId}/tags`);
  const response = await client.post(`/contacts/${contactId}/tags`, {
    tags: [tag],
  });
  return response.data;
}

async function removeTagFromContact(client, contactId, tag) {
  console.log("GHL_REQUEST_URL", `${GHL_BASE_URL}/contacts/${contactId}/tags`);
  const response = await client.delete(`/contacts/${contactId}/tags`, {
    data: { tags: [tag] },
  });
  return response.data;
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/debug-routes", (req, res) => {
  const hasEmailPlan =
    Boolean(app && app._router && Array.isArray(app._router.stack)
      ? app._router.stack.some(
          (layer) => layer && layer.route && layer.route.path === "/email-plan"
        )
      : false);
  res.json({
    hasEmailPlan,
    baseUrl: GHL_BASE_URL,
    envHasToken: Boolean((process.env.GHL_API_KEY || "").trim()),
    envHasLocation: Boolean((process.env.GHL_LOCATION_ID || "").trim()),
    routeHint: "Expected POST /email-plan",
  });
});

app.get("/email-plan", (req, res) => res.status(200).send("email-plan OK"));

app.post("/email-plan", async (req, res) => {
  console.log("EMAIL_PLAN_HIT");
  console.log(
    "HEADERS_AUTH_PRESENT",
    Boolean(req.headers.authorization),
    Boolean(req.headers["x-api-key"])
  );
  const ghlToken = (process.env.GHL_API_KEY || "").trim();
  const ghlLocationId = (process.env.GHL_LOCATION_ID || "").trim();
  console.log("GHL_KEY_PREFIX", ghlToken.slice(0, 4));
  console.log("GHL_KEY_LENGTH", ghlToken.length);
  if (!ghlToken) {
    console.log("API_RESPONSE_STATUS", 500, "missing_token");
    return res.status(500).json({ ok: false, error: "GHL_API_KEY is not set." });
  }
  if (!ghlLocationId) {
    console.log("API_RESPONSE_STATUS", 500, "missing_location");
    return res.status(500).json({ ok: false, error: "Missing GHL_LOCATION_ID" });
  }
  try {
    try {
      const {
        full_name,
        email,
        profit_target,
        max_loss_limit,
        max_contract_size,
        daily_loss_limit,
        trades_until_lost,
        consistency_enabled,
        consistency_rule,
        product,
        stop_loss_ticks,
        suggested_contracts,
        risk_per_trade,
        max_sl_hits_per_day,
        daily_profit_target,
        max_daily_profit,
      } = req.body || {};

      if (!full_name || !email) {
        console.log("API_RESPONSE_STATUS", 400, "missing_identity");
        return res.status(400).json({ ok: false, error: "full_name and email are required." });
      }

      const client = getGhlClient(ghlToken);
      const rawHeaders = client.defaults.headers || {};
      const headerKeys = Object.keys(rawHeaders).filter(
        (key) => !["common", "get", "post", "put", "patch", "delete", "head"].includes(key)
      );
      const authHeader =
        rawHeaders.Authorization ||
        (rawHeaders.common && rawHeaders.common.Authorization) ||
        null;
      const versionHeader =
        rawHeaders.Version || (rawHeaders.common && rawHeaders.common.Version) || null;
      console.log("GHL_BASE_URL", GHL_BASE_URL);
      console.log("GHL_HEADERS_KEYS", headerKeys);
      console.log(
        "GHL_AUTH_FORMAT_OK",
        typeof authHeader === "string" && /^Bearer\s+\S+$/u.test(authHeader)
      );
      console.log("GHL_VERSION_PRESENT", Boolean(versionHeader));
      let existing;
      try {
        existing = await lookupContactByEmail(client, email, ghlLocationId);
      } catch (err) {
        console.log("GHL_ERROR_STATUS", err?.response?.status);
        console.log("GHL_ERROR_DATA", err?.response?.data);
        throw err;
      }

      const contactPayload = {
        locationId: ghlLocationId,
        name: full_name,
        email,
      };

      let contactId;
      if (existing && existing.id) {
        try {
          const updated = await updateContact(client, existing.id, contactPayload);
          contactId = updated && updated.contact ? updated.contact.id : existing.id;
        } catch (err) {
          console.log("GHL_ERROR_STATUS", err?.response?.status);
          console.log("GHL_ERROR_DATA", err?.response?.data);
          throw err;
        }
      } else {
        try {
          const created = await createContact(client, contactPayload);
          contactId = created && created.contact ? created.contact.id : null;
        } catch (err) {
          console.log("GHL_ERROR_STATUS", err?.response?.status);
          console.log("GHL_ERROR_DATA", err?.response?.data);
          throw err;
        }
      }

      if (!contactId) {
        console.log("API_RESPONSE_STATUS", 502, "missing_contact");
        return res.status(502).json({ ok: false, error: "Unable to resolve contact ID." });
      }

      try {
        console.log("TAG_REMOVE_ATTEMPT", contactId);
        await removeTagFromContact(client, contactId, "risk_calculator_plan");
        console.log("TAG_REMOVE_SUCCESS", contactId);
      } catch (err) {
        console.log("TAG_REMOVE_FAILED", err?.response?.data || err?.message);
      }

      try {
        console.log("TAG_ADD_ATTEMPT", contactId);
        await addTagToContact(client, contactId, "risk_calculator_plan");
        console.log("TAG_ADD_SUCCESS", contactId);
      } catch (err) {
        console.log("TAG_ADD_FAILED", err?.response?.data || err?.message);
        console.log("API_RESPONSE_STATUS", 500, "tag_add_failed");
        return res.status(500).json({ error: "Failed to apply tag" });
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      const message =
        err.response && err.response.data ? err.response.data : { error: err.message };
      if (err.response && err.response.status === 401) {
        console.log("SERVER_401_REASON", "ghl_response");
      }
      console.log("API_RESPONSE_STATUS", 500, "ghl_error");
      return res.status(500).json({ ok: false, error: message });
    }
  } catch (err) {
    console.log("API_UNHANDLED_ERROR", err?.message);
    console.log("API_UNHANDLED_ERROR_STATUS", err?.response?.status);
    console.log("API_UNHANDLED_ERROR_DATA", err?.response?.data);
    console.log("API_RESPONSE_STATUS", 500, "unhandled_error");
    return res.status(500).json({ error: "email-plan failed", details: err?.message });
  }
});

console.log("EMAIL PLAN ROUTE ACTIVE");

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
