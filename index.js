const express = require("express");
const cors = require("cors");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: "https://tools.daytradinguni.com",
    methods: ["GET", "POST", "OPTIONS"],
  })
);

const GHL_BASE_URL = "https://rest.gohighlevel.com/v1";
const GHL_LOCATION_ID = "OiIKORhJ82flAVisHu3d";

function getGhlClient() {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) {
    throw new Error("GHL_API_KEY is not set.");
  }
  return axios.create({
    baseURL: GHL_BASE_URL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
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

    const client = getGhlClient();
    const existing = await lookupContactByEmail(client, email);

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
      locationId: GHL_LOCATION_ID,
      name: full_name,
      email,
      customFields,
    };

    let contactId;
    if (existing && existing.id) {
      const updated = await updateContact(client, existing.id, contactPayload);
      contactId = updated && updated.contact ? updated.contact.id : existing.id;
    } else {
      const created = await createContact(client, contactPayload);
      contactId = created && created.contact ? created.contact.id : null;
    }

    if (!contactId) {
      return res.status(502).json({ ok: false, error: "Unable to resolve contact ID." });
    }

    await addTagToContact(client, contactId, "risk_calculator_plan");

    return res.json({ ok: true });
  } catch (err) {
    const status = err.response && err.response.status ? err.response.status : 500;
    const message =
      err.response && err.response.data ? err.response.data : { error: err.message };
    return res.status(status).json({ ok: false, error: message });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
