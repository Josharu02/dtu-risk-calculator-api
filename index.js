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
let cachedCustomFieldMap = null;
let customFieldMapPromise = null;

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

async function getCustomFieldMap(client, locationId) {
  if (cachedCustomFieldMap) {
    return cachedCustomFieldMap;
  }
  if (customFieldMapPromise) {
    return customFieldMapPromise;
  }
  customFieldMapPromise = (async () => {
    console.log("GHL_REQUEST_URL", `${GHL_BASE_URL}/custom-fields`);
    const response = await client.get("/custom-fields", {
      params: { locationId },
    });
    const data = response && response.data ? response.data : {};
    const fields = Array.isArray(data.customFields)
      ? data.customFields
      : Array.isArray(data.custom_fields)
      ? data.custom_fields
      : [];
    const fieldMap = {};
    fields.forEach((field) => {
      const key = field && (field.fieldKey || field.key);
      const id = field && (field.id || field._id);
      if (key && id) {
        fieldMap[key] = id;
      }
    });
    cachedCustomFieldMap = fieldMap;
    return fieldMap;
  })();
  try {
    return await customFieldMapPromise;
  } finally {
    customFieldMapPromise = null;
  }
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
  const ghlToken = (process.env.GHL_API_KEY || "").trim();
  const ghlLocationId = (process.env.GHL_LOCATION_ID || "").trim();
  console.log("GHL_KEY_PREFIX", ghlToken.slice(0, 4));
  console.log("GHL_KEY_LENGTH", ghlToken.length);
  if (!ghlToken) {
    return res.status(500).json({ ok: false, error: "GHL_API_KEY is not set." });
  }
  if (!ghlLocationId) {
    return res.status(500).json({ ok: false, error: "Missing GHL_LOCATION_ID" });
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

    const fieldMap = await getCustomFieldMap(client, ghlLocationId);
    const fieldKeys = [
      "product_traded",
      "stop_loss_size_ticks",
      "suggested_contracts",
      "risk_per_trade",
      "daily_loss_limit",
      "max_full_stop_losses_day",
      "profit_target",
      "daily_profit_target",
      "max_daily_profit",
      "consistency_enabled",
    ];
    fieldKeys.forEach((key) => {
      if (fieldMap[key]) {
        console.log("CUSTOM_FIELD_MAPPED", key);
      } else {
        console.warn("CUSTOM_FIELD_MISSING", key);
      }
    });

    const fieldValues = {
      product_traded: product,
      stop_loss_size_ticks: stop_loss_ticks,
      suggested_contracts,
      risk_per_trade,
      daily_loss_limit,
      max_full_stop_losses_day: max_sl_hits_per_day,
      profit_target,
      daily_profit_target,
      max_daily_profit,
    };
    if (consistency_enabled === true) {
      fieldValues.consistency_enabled = "true";
    }

    const sanitizedCustomFields = Object.entries(fieldValues)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => {
        const id = fieldMap[key];
        if (!id) {
          return null;
        }
        return { id, value };
      })
      .filter(Boolean);

    const contactPayload = {
      locationId: ghlLocationId,
      name: full_name,
      email,
      customFields: sanitizedCustomFields,
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
