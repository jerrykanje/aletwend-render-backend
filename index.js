 const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());

/* =======================================================
   🔥 FIREBASE INIT (UNCHANGED)
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
   🚗 MAIN DRIVER VEHICLE SAVE ROUTE (UNCHANGED + SAFE)
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
          maxSeats = 4;
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
        uid,
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
   🔥 HELPERS
======================================================= */

// KM distance
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;

  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// safe fare
function calculateFare(baseFare, km) {
  return Math.round(baseFare + km * 6);
}

function titleCase(cat) {
  const map = {
    economy: "Economy",
    comfort: "Comfort",
    xl: "XL",
    premium: "Premium",
    women: "Women",
    aletwende: "Aletwende",

    bike: "Bike",
    motorbike: "Motorbike",
    car: "Car",
    truck: "Truck",

    tow_standard: "Tow Standard",
    tow_heavy: "Heavy Duty Tow",

    refrigerated: "Cold Storage Truck",
    enclosed: "Closed Truck",
    open: "Open Truck"
  };

  return map[cat] || cat;
}

/* =======================================================
   DRIVER LOADER
======================================================= */
async function getAvailableDrivers(pickupLat, pickupLng) {
  const onlineSnap = await rtdb.ref("drivers_online").once("value");
  const locationSnap = await rtdb.ref("driver_locations").once("value");

  const online = onlineSnap.val() || {};
  const locations = locationSnap.val() || {};

  const driversSnap = await db.collection("drivers").get();

  const drivers = [];

  driversSnap.forEach((doc) => {
    const d = doc.data();
    const uid = d.uid || doc.id;

    if (!uid) return;
    if (!online[uid]) return;
    if (!online[uid].isOnline) return;
    if (online[uid].isBusy) return;
    if (!locations[uid]) return;
    if (!d.vehicle) return;

    const lat = locations[uid]?.l?.[0];
    const lng = locations[uid]?.l?.[1];

    if (lat == null || lng == null) return;

    const distance = haversine(
      pickupLat,
      pickupLng,
      lat,
      lng
    );

    if (distance > 10) return;

    drivers.push({
      uid,
      rating: d.rating || 0,
      distance,
      vehicle: d.vehicle
    });
  });

  return drivers;
}

/* =======================================================
   CATEGORY BUILDERS
======================================================= */

async function buildCards(categories, drivers, tripKm) {
  const cards = [];

  for (const category of categories) {
    let matches = drivers.filter((d) => {
      const v = d.vehicle;

      if (category === "economy")
        return v.pricingCategory === "ride_economy";

      if (category === "comfort")
        return v.pricingCategory === "ride_comfort";

      if (category === "xl")
        return v.pricingCategory === "ride_xl";

      if (category === "premium")
        return v.pricingCategory === "ride_premium";

      if (category === "women")
        return v.pricingCategory === "ride_women";

      if (category === "aletwende")
        return v.pricingCategory === "ride_aletwende";

      if (category === "bike")
        return v.type === "bicycle";

      if (category === "motorbike")
        return v.type === "motorbike";

      if (category === "car")
        return v.type === "car";

      if (category === "truck")
        return v.type === "truck";

      if (category === "refrigerated")
        return (
          v.type === "truck" &&
          v.refrigerationType === "refrigerated"
        );

      if (category === "enclosed")
        return (
          v.type === "truck" &&
          v.cargoType !== "open"
        );

      if (category === "open")
        return v.type === "truck";

      return false;
    });

    matches.sort((a, b) => a.distance - b.distance);

    if (!matches.length) {
      cards.push({
        category,
        title: titleCase(category),
        enabled: false,
        eta: null,
        price: null,
        seats: null,
        availableDrivers: 0,
        image: `${category}.png`
      });
      continue;
    }

    const best = matches[0];

    let baseFare = 40;

    const pricingId = best.vehicle.pricingCategory;

    if (pricingId) {
      const snap = await db
        .collection("pricing")
        .doc(pricingId)
        .get();

      if (snap.exists) {
        const p = snap.data() || {};
        baseFare =
          p.baseFare ||
          p.base ||
          p.startingFare ||
          40;
      }
    }

    cards.push({
      category,
      title: titleCase(category),
      enabled: true,
      eta: Math.max(2, Math.round(best.distance * 2)),
      price: calculateFare(baseFare, tripKm),
      seats: best.vehicle.maxSeats || 1,
      availableDrivers: matches.length,
      image: `${category}.png`
    });
  }

  return cards;
}

/* =======================================================
   🚀 MAIN UNIVERSAL CLIENT APP ROUTE
======================================================= */

app.post("/getRideOptions", async (req, res) => {
  try {
    const body = req.body || {};

    const serviceType = val(body.serviceType).toLowerCase();

    const pickupLat = Number(body.pickupLat);
    const pickupLng = Number(body.pickupLng);
    const dropLat = Number(body.dropLat);
    const dropLng = Number(body.dropLng);

    if (
      isNaN(pickupLat) ||
      isNaN(pickupLng) ||
      isNaN(dropLat) ||
      isNaN(dropLng)
    ) {
      return res.status(400).json({
        error: "Missing coordinates"
      });
    }

    const kg = val(body.kg);
    const category = val(body.category).toLowerCase();
    const truckType = val(body.truckType).toLowerCase();
    const vehicleType = val(body.vehicleType).toLowerCase();

    const tripKm = haversine(
      pickupLat,
      pickupLng,
      dropLat,
      dropLng
    );

    const drivers = await getAvailableDrivers(
      pickupLat,
      pickupLng
    );

    let filters = [];
    let categories = [];

    /* ===============================
       RIDE
    =============================== */
    if (serviceType === "ride") {
      filters = ["Cheap", "Fast", "Luxury"];

      categories = [
        "economy",
        "comfort",
        "xl",
        "premium",
        "women",
        "aletwende"
      ];
    }

    /* ===============================
       COURIER
    =============================== */
    else if (serviceType === "courier") {
      filters = ["Cheap", "Fast", "Bike"];

      if (kg === "0-5kg") {
        categories = [
          "bike",
          "motorbike",
          "car"
        ];
      } else if (kg === "5-10kg") {
        categories = [
          "motorbike",
          "car",
          "truck"
        ];
      } else if (kg === "10-20kg") {
        categories = [
          "car",
          "truck"
        ];
      } else {
        categories = [
          "truck",
          "car"
        ];
      }
    }

    /* ===============================
       DELIVERY (hardware)
    =============================== */
    else if (serviceType === "delivery") {
      filters = ["Cheap", "Fast", "Capacity"];

      categories = [
        "bike",
        "motorbike",
        "car",
        "truck"
      ];
    }

    /* ===============================
       DELIVERY TRUCK
    =============================== */
    else if (serviceType === "delivery_truck") {
      filters = [
        "Standard",
        "Heavy",
        "Cold Storage"
      ];

      if (truckType === "farm produce") {
        categories = [
          "refrigerated",
          "enclosed",
          "open"
        ];
      } else {
        categories = [
          "open",
          "enclosed",
          "refrigerated"
        ];
      }
    }

    /* ===============================
       TOWING
    =============================== */
    else if (serviceType === "towing") {
      filters = [
        "Cheap",
        "Fast",
        "Heavy Duty"
      ];

      categories = [
        "truck",
        "car"
      ];
    }

    else {
      return res.status(400).json({
        error: "Invalid serviceType"
      });
    }

    const cards = await buildCards(
      categories,
      drivers,
      tripKm
    );

    return res.json({
      success: true,
      serviceType,
      filters,
      cards
    });

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