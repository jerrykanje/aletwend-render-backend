const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());

// 🔥 Firebase init using ENV variable
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.RTDB_URL // ADD THIS in Render env vars
});

const db = admin.firestore();
const rtdb = admin.database();

// IMPORTANT
db.settings({
  ignoreUndefinedProperties: true
});

// helper
const val = (x) => x ?? "";

/* =======================================================
   🔥 TEST FIRESTORE ROUTE (UNCHANGED)
======================================================= */
app.get("/testfirestore", async (req, res) => {
  try {
    await db.collection("test").doc("ping").set({
      time: new Date().toISOString()
    });

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

/* =======================================================
   🚗 MAIN ROUTE (UNCHANGED)
======================================================= */
app.post("/classifyVehicleAndSaveDriver", async (req, res) => {
  try {
    const body = req.body || {};

    const uid = val(body.uid);
    const type = val(body.type).toLowerCase();

    if (!uid || !type) {
      return res.status(400).json({
        error: "Missing uid or type"
      });
    }

    const brand = val(body.brand);
    const model = val(body.model);
    const productionYear = val(body.productionYear);
    const plateNumber = val(body.plateNumber);
    const color = val(body.color);

    const services = Array.isArray(body.services)
      ? body.services
      : [];

    const cargoType = val(body.cargoType);
    const refrigerationType = val(body.refrigerationType);
    const tonnage = val(body.tonnage);

    const imageUrls = body.imageUrls || {};

    let vehicleCategory = "";
    let pricingCategory = "";
    let maxSeats = 0;

    switch (type) {
      case "car":
        if (services.includes("ride")) {
          vehicleCategory = "economy";
          pricingCategory = "ride_economy";
          maxSeats = 3;
        } else {
          vehicleCategory = "delivery_car";
          pricingCategory = "delivery_car";
        }
        break;

      case "minibus":
        vehicleCategory = "xl";
        pricingCategory = "ride_xl";
        maxSeats = 10;
        break;

      case "bicycle":
        vehicleCategory = "delivery_bicycle";
        pricingCategory = "delivery_bicycle";
        break;

      case "motorbike":
        vehicleCategory = "delivery_motorbike";
        pricingCategory = "delivery_motorbike";
        break;

      case "truck":
        vehicleCategory = "delivery_truck";

        if (cargoType === "open") {
          pricingCategory = `truck_${tonnage}ton`;
        } else if (refrigerationType === "refrigerated") {
          pricingCategory = `refrigerated_truck_${tonnage}ton`;
        } else {
          pricingCategory = `enclosed_truck_${tonnage}ton`;
        }
        break;

      default:
        return res.status(400).json({
          error: "Invalid vehicle type"
        });
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
      vehicleCategory,
      pricingCategory,
      maxSeats,
      carImage: val(imageUrls.carImage),
      vehicleLicense: val(imageUrls.vehicleLicense),
      registrationCertificate: val(
        imageUrls.registrationCertificate
      )
    };

    await db.collection("drivers").doc(uid).set(
      {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        registrationStep: 6,
        vehicle
      },
      { merge: true }
    );

    return res.json({
      success: true,
      vehicleCategory,
      pricingCategory,
      maxSeats
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: error.message
    });
  }
});

/* =======================================================
   🔥 HELPERS FOR CLIENT APP
======================================================= */

// distance in KM
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;

  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// simple price calculator
function calculateFare(baseFare, km) {
  return Math.round(baseFare + (km * 6));
}

// category titles
function titleCase(cat) {
  const map = {
    economy: "Economy",
    comfort: "Comfort",
    xl: "XL",
    premium: "Premium",
    women: "Women",
    aletwende: "Aletwende"
  };

  return map[cat] || cat;
}

/* =======================================================
   🚕 NEW ROUTE FOR CLIENT APP
======================================================= */

app.post("/getRideOptions", async (req, res) => {
  try {
    const body = req.body || {};

    const pickupLat = Number(body.pickupLat);
    const pickupLng = Number(body.pickupLng);
    const dropLat = Number(body.dropLat);
    const dropLng = Number(body.dropLng);

    if (!pickupLat || !pickupLng || !dropLat || !dropLng) {
      return res.status(400).json({
        error: "Missing coordinates"
      });
    }

    const tripKm = haversine(
      pickupLat,
      pickupLng,
      dropLat,
      dropLng
    );

    // always show all cards
    const categories = [
      "economy",
      "comfort",
      "xl",
      "premium",
      "women",
      "aletwende"
    ];

    // realtime db
    const onlineSnap = await rtdb.ref("drivers_online").once("value");
    const locationSnap = await rtdb.ref("driver_locations").once("value");

    const online = onlineSnap.val() || {};
    const locations = locationSnap.val() || {};

    // firestore drivers
    const driversSnap = await db.collection("drivers").get();

    const drivers = [];

    driversSnap.forEach((doc) => {
      const d = doc.data();

      const uid = d.uid;

      if (!uid) return;
      if (!online[uid]) return;
      if (!online[uid].isOnline) return;
      if (online[uid].isBusy) return;
      if (!locations[uid]) return;
      if (!d.vehicle) return;
      if (!d.vehicle.vehicleCategory) return;

      const lat = locations[uid].l[0];
      const lng = locations[uid].l[1];

      const distance = haversine(
        pickupLat,
        pickupLng,
        lat,
        lng
      );

      // only nearby drivers 7km
      if (distance > 5) return;

      drivers.push({
        uid,
        rating: d.rating || 0,
        distance,
        vehicle: d.vehicle
      });
    });

    const cards = [];

    for (const category of categories) {

      // special mappings
      let matches = drivers.filter((x) => {
        if (category === "economy") {
          return x.vehicle.vehicleCategory === "economy";
        }

        if (category === "xl") {
          return x.vehicle.vehicleCategory === "xl";
        }

        if (category === "comfort") {
          return x.vehicle.pricingCategory === "ride_comfort";
        }

        if (category === "premium") {
          return x.vehicle.pricingCategory === "ride_premium";
        }

        if (category === "women") {
          return x.vehicle.pricingCategory === "ride_women";
        }

        if (category === "aletwende") {
          return x.vehicle.pricingCategory === "ride_aletwende";
        }

        return false;
      });

      // best driver first
      matches.sort((a, b) => {
        if (a.distance !== b.distance) {
          return a.distance - b.distance;
        }

        return b.rating - a.rating;
      });

      if (matches.length === 0) {
        cards.push({
          category,
          title: titleCase(category),
          enabled: false,
          eta: null,
          price: null,
          seats: null,
          image: `${category}.png`
        });

        continue;
      }

      const best = matches[0];

      const pricingId = best.vehicle.pricingCategory;

      const pricingDoc = await db
        .collection("pricing")
        .doc(pricingId)
        .get();

      let baseFare = 40;

      if (pricingDoc.exists) {
        const pdata = pricingDoc.data() || {};
        baseFare =
          pdata.baseFare ||
          pdata.base ||
          pdata.startingFare ||
          40;
      }

      const eta = Math.max(
        2,
        Math.round(best.distance * 2)
      );

      const price = calculateFare(baseFare, tripKm);

      cards.push({
        category,
        title: titleCase(category),
        enabled: true,
        eta,
        price,
        seats: best.vehicle.maxSeats || 4,
        image: `${category}.png`
      });
    }

    return res.json(cards);

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: error.message
    });
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