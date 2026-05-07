 const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());

/* =======================================================
   🔥 FIREBASE INIT
======================================================= */
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.RTDB_URL
});

const db = admin.firestore();
const rtdb = admin.database();

db.settings({
  ignoreUndefinedProperties: true
});

// helper
const val = (x) => x ?? "";

/* =======================================================
   🚚 MASTER TRUCK TABLE
======================================================= */
const TRUCK_MASTER = {
  h100: { tonnage: 1.5 },
  canter: { tonnage: 2 },
  dyna: { tonnage: 3 },
  kia2700: { tonnage: 2.5 },
  fuso: { tonnage: 5 }
};

/* =======================================================
   🔥 TEST FIRESTORE ROUTE
======================================================= */
app.get("/testfirestore", async (req, res) => {
  try {
    await db.collection("test").doc("ping").set({
      time: new Date().toISOString()
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* =======================================================
   🚗 SAVE DRIVER VEHICLE (DYNAMIC FIX)
======================================================= */
app.post("/classifyVehicleAndSaveDriver", async (req, res) => {
  try {
    const body = req.body || {};

    const uid = val(body.uid);
    const type = val(body.type).toLowerCase();

    if (!uid || !type) {
      return res.status(400).json({ error: "Missing uid or type" });
    }

    const brand = val(body.brand);
    const model = val(body.model);
    const productionYear = val(body.productionYear);
    const plateNumber = val(body.plateNumber);
    const color = val(body.color);

    let services = Array.isArray(body.services) ? body.services : [];

    const cargoType = val(body.cargoType);
    const refrigerationType = val(body.refrigerationType);

    const vehicleType = val(body.vehicleType || body.model).toLowerCase();

    const imageUrls = body.imageUrls || {};

    let vehicleCategories = [];
    let pricingCategories = [];
    let maxSeats = 0;
    let tonnage = null;

    /* =======================================================
       🚗 CAR (🔥 FIXED: USE RULES)
    ======================================================= */
    if (type === "car") {
      const vehicleKey = `${brand}_${model}`.toLowerCase().replace(/\s+/g, "_");

      const rulesDoc = await db.collection("vehicle_service_rules").doc(vehicleKey).get();

      if (rulesDoc.exists) {
        const rules = rulesDoc.data();

        const allowedRideCategories = rules.allowedRideCategories || [];
        const defaultRideCategory = rules.defaultRideCategory?.[0];

        vehicleCategories = [...allowedRideCategories];

        pricingCategories = allowedRideCategories.map(cat => `ride_${cat}`);

        if (defaultRideCategory) {
          const catDoc = await db.collection("ride_categories").doc(defaultRideCategory).get();
          if (catDoc.exists) {
            maxSeats = catDoc.data().maxPassengers || 4;
          }
        }
      }

      if (services.includes("courier") || services.includes("delivery")) {
        vehicleCategories.push("delivery_car");
        pricingCategories.push("delivery_car");
      }
    }

    /* =======================================================
       🏍️ MOTORBIKE
    ======================================================= */
    if (type === "motorbike") {
      services = ["delivery", "courier"];
      vehicleCategories.push("delivery_motorbike");
      pricingCategories.push("delivery_motorbike");
    }

    /* =======================================================
       🚚 TRUCK
    ======================================================= */
    if (type === "truck") {
      services = ["delivery", "delivery_truck"];

      const master = TRUCK_MASTER[vehicleType];
      if (!master) return res.status(400).json({ error: "Unknown truck type" });

      tonnage = master.tonnage;

      vehicleCategories.push("delivery_truck");

      if (refrigerationType === "refrigerated") {
        pricingCategories.push(`refrigerated_truck_${tonnage}ton`);
      } else if (cargoType === "open") {
        pricingCategories.push(`open_truck_${tonnage}ton`);
      } else {
        pricingCategories.push(`closed_truck_${tonnage}ton`);
      }
    }

    /* =======================================================
       🚌 MINIBUS
    ======================================================= */
    if (type === "minibus") {
      services = ["ride"];
      vehicleCategories.push("xxl");
      pricingCategories.push("ride_xxl");
      maxSeats = 10;
    }

    /* =======================================================
       🚲 BICYCLE
    ======================================================= */
    if (type === "bicycle") {
      services = ["delivery", "courier"];
      vehicleCategories.push("delivery_bicycle");
      pricingCategories.push("delivery_bicycle");
    }

    const vehicle = {
      type,
      brand,
      model,
      productionYear,
      plateNumber,
      color,
      services,
      cargoType,
      refrigerationType,
      tonnage,
      vehicleCategory: vehicleCategories,
      pricingCategory: pricingCategories,
      maxSeats,
      carImage: val(imageUrls.carImage),
      vehicleLicense: val(imageUrls.vehicleLicense),
      registrationCertificate: val(imageUrls.registrationCertificate)
    };

    await db.collection("drivers").doc(uid).set(
      {
        uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        registrationStep: 6,
        vehicle
      },
      { merge: true }
    );

    return res.json({ success: true, vehicleCategories, pricingCategories });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/* =======================================================
   HELPERS
======================================================= */

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function calculateFare(baseFare, km) {
  return Math.round(baseFare + (km * 6));
}

/* =======================================================
   🚕 GET RIDE OPTIONS (🔥 FULLY FIXED LOGIC)
======================================================= */
app.post("/getRideOptions", async (req, res) => {
  try {
    const body = req.body || {};

    const pickupLat = Number(body.pickupLat);
    const pickupLng = Number(body.pickupLng);
    const dropLat = Number(body.dropLat);
    const dropLng = Number(body.dropLng);

    const serviceType = (body.serviceType || "ride").toLowerCase();
    const kg = body.kg || "0-5kg";
    const deliveryType = body.deliveryType || "";

    const tripKm = haversine(pickupLat, pickupLng, dropLat, dropLng);

    let categories = [];

    /* =======================================================
       🔥 SERVICE LOGIC (FIXED PROPERLY)
    ======================================================= */

    if (serviceType === "ride") {
      categories = ["economy", "comfort", "premium", "women", "aletwende", "xl", "xxl"];
    }

    if (serviceType === "courier") {
      categories = ["delivery_bicycle", "delivery_motorbike", "delivery_car"];
    }

    if (serviceType === "delivery") {
      // 🔥 INCLUDE EVERYTHING (WITH KG LOGIC)
      if (kg === "0-5kg") categories = ["delivery_bicycle"];
      else if (kg === "5-20kg") categories = ["delivery_motorbike"];
      else if (kg === "20-100kg") categories = ["delivery_car"];
      else categories = ["delivery_truck"];
    }

    if (serviceType === "delivery_truck") {
      categories = ["delivery_truck"];
    }

    /* =======================================================
       FETCH DRIVERS
    ======================================================= */
    const onlineSnap = await rtdb.ref("drivers_online").once("value");
    const locationSnap = await rtdb.ref("driver_locations").once("value");

    const online = onlineSnap.val() || {};
    const locations = locationSnap.val() || {};

    const driversSnap = await db.collection("drivers").get();

    const drivers = [];

    driversSnap.forEach((doc) => {
      const d = doc.data() || {};
      const uid = d.uid || doc.id;

      if (!uid) return;
      if (!online[uid]?.isOnline) return;
      if (online[uid]?.isBusy) return;
      if (!locations[uid]?.l) return;
      if (!d.vehicle) return;

      if (!d.vehicle.services.includes(serviceType)) return;

      const lat = Number(locations[uid].l[0]);
      const lng = Number(locations[uid].l[1]);

      const distance = haversine(pickupLat, pickupLng, lat, lng);
      if (distance > 7) return;

      drivers.push({ uid, distance, vehicle: d.vehicle });
    });

    /* =======================================================
       🚚 TRUCK PRIORITY SORT
    ======================================================= */
    if (serviceType === "delivery_truck") {
      drivers.sort((a, b) => {
        if (deliveryType === "farm-produce") {
          return (
            (b.vehicle.refrigerationType === "refrigerated") -
            (a.vehicle.refrigerationType === "refrigerated")
          );
        }
        return a.distance - b.distance;
      });
    }

    const cards = [];

    for (const category of categories) {
      const match = drivers.find(d =>
        d.vehicle.vehicleCategory.includes(category)
      );

      if (!match) {
        cards.push({
          category,
          title: category,
          enabled: false,
          eta: null,
          price: null,
          seats: null,
          image: `${category}.png`
        });
        continue;
      }

      const pricingKey =
        match.vehicle.pricingCategory.find(p => p.includes(category)) ||
        match.vehicle.pricingCategory[0];

      const pricingDoc = await db.collection("pricing").doc(pricingKey).get();

      let baseFare = 40;
      if (pricingDoc.exists) {
        baseFare = pricingDoc.data().baseFare || 40;
      }

      const eta = Math.max(2, Math.round(match.distance * 2));
      const price = calculateFare(baseFare, tripKm);

      cards.push({
        category,
        title: category,
        enabled: true,
        eta,
        price,
        seats: match.vehicle.maxSeats || 4,
        image: `${category}.png`
      });
    }

    return res.json(cards);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/* =======================================================
   HOME
======================================================= */
app.get("/", (req, res) => {
  res.send("Backend running 🚀");
});

/* =======================================================
   START SERVER
======================================================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});