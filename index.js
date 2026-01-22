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

const GHL_BASE_URL = "https://rest.gohighlevel.com/v1";

function getGhlClient(ghlApiKey) {
  return axios.create({
    baseURL: GHL_BASE_URL,
    headers: {
      Authorization: `Bearer ${ghlApiKey}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    },
    timeout: 15000,
  });
}

async function lookupContactByEmail(client, email) {
  const response = await client.get("/contacts/lookup", {
    params: { email },
  });
  return response.data && response.data.contacts && response.data.contacts[0]
    ? response.data.contacts[0]
    : null;
}

async function createContact(client, payload) {
  const response = await client.post("/contacts/", payload);
  return response.data;
}

async function updateContact(client, contactId, payload) {
  const response = await client.put(`/contacts/${contactId}`, payload);
  return response.data;
}

async function addTagToContact(client, contactId, tag) {
  const response = await client.post(`/contacts/${contactId}/tags`, {
    tags: [tag],
  });
  return response.data;
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/email-plan", async (req, res) => {
  console.log("EMAIL_PLAN_HIT");
  console.log(
    "HEADERS_AUTH_PRESENT",
    Boolean(req.headers.authorization),
    Boolean(req.headers["x-api-key"])
  );
  const ghlApiKey = (process.env.GHL_API_KEY || "").trim();
  const ghlLocationId = (process.env.GHL_LOCATION_ID || "").trim();
  console.log("GHL_KEY_LENGTH", ghlApiKey.length);
  if (!ghlApiKey) {
    return res.status(500).json({ ok: false, error: "GHL_API_KEY is not set." });
  }
  if (!ghlLocationId) {
    return res.status(500).json({ ok: false, error: "GHL_LOCATION_ID is not set." });
  }
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
      return res.status(400).json({ ok: false, error: "full_name and email are required." });
    }

    const client = getGhlClient(ghlApiKey);
    let existing;
    try {
      existing = await lookupContactByEmail(client, email);
    } catch (err) {
      console.log("GHL_ERROR_STATUS", err?.response?.status);
      console.log("GHL_ERROR_DATA", err?.response?.data);
      throw err;
    }

    const customFields = [
      { key: "profit_target", value: profit_target },
      { key: "max_loss_limit", value: max_loss_limit },
      { key: "max_contract_size", value: max_contract_size },
      { key: "daily_loss_limit", value: daily_loss_limit },
      { key: "trades_until_lost", value: trades_until_lost },
      { key: "consistency_enabled", value: consistency_enabled },
      { key: "consistency_rule", value: consistency_rule },
      { key: "product", value: product },
      { key: "stop_loss_ticks", value: stop_loss_ticks },
      { key: "suggested_contracts", value: suggested_contracts },
      { key: "risk_per_trade", value: risk_per_trade },
      { key: "max_sl_hits_per_day", value: max_sl_hits_per_day },
      { key: "daily_profit_target", value: daily_profit_target },
      { key: "max_daily_profit", value: max_daily_profit },
    ];

    const contactPayload = {
      locationId: ghlLocationId,
      name: full_name,
      email,
      customFields,
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
      return res.status(502).json({ ok: false, error: "Unable to resolve contact ID." });
    }

    try {
      await addTagToContact(client, contactId, "risk_calculator_plan");
    } catch (err) {
      console.log("GHL_ERROR_STATUS", err?.response?.status);
      console.log("GHL_ERROR_DATA", err?.response?.data);
      throw err;
    }

    return res.json({ ok: true });
  } catch (err) {
    const status = err.response && err.response.status ? err.response.status : 500;
    const message =
      err.response && err.response.data ? err.response.data : { error: err.message };
    if (status === 401) {
      console.log("SERVER_401_REASON", "ghl_response");
    }
    return res.status(status).json({ ok: false, error: message });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
