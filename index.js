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
   🔥 TEST FIRESTORE ROUTE
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
   🚗 SAVE DRIVER VEHICLE (UPDATED FOR MULTI-SERVICE)
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

    let vehicleCategories = [];
    let pricingCategories = [];
    let maxSeats = 0;

    /* ===== VEHICLE CLASSIFICATION ===== */

    if (type === "car") {
      if (services.includes("ride")) {
        vehicleCategories.push("economy");
        pricingCategories.push("ride_economy");
        maxSeats = 3;
      }

      if (services.includes("courier") || services.includes("delivery")) {
        vehicleCategories.push("delivery_car");
        pricingCategories.push("delivery_car");
      }
    }

    if (type === "minibus") {
      vehicleCategories.push("xl");
      pricingCategories.push("ride_xl");
      maxSeats = 10;
    }

    if (type === "bicycle") {
      vehicleCategories.push("delivery_bicycle");
      pricingCategories.push("delivery_bicycle");
    }

    if (type === "motorbike") {
      vehicleCategories.push("delivery_motorbike");
      pricingCategories.push("delivery_motorbike");
    }

    if (type === "truck") {
      vehicleCategories.push("delivery_truck");

      if (cargoType === "open") {
        pricingCategories.push(`truck_${tonnage}ton`);
      } else if (refrigerationType === "refrigerated") {
        pricingCategories.push(`refrigerated_truck_${tonnage}ton`);
      } else {
        pricingCategories.push(`enclosed_truck_${tonnage}ton`);
      }
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
      vehicleCategories,
      pricingCategories,
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
   HELPERS
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

function calculateFare(baseFare, km) {
  return Math.round(baseFare + (km * 6));
}

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
   🚕 GET RIDE OPTIONS (FULLY FIXED)
======================================================= */
app.post("/getRideOptions", async (req, res) => {
  try {
    const body = req.body || {};

    const pickupLat = Number(body.pickupLat);
    const pickupLng = Number(body.pickupLng);
    const dropLat = Number(body.dropLat);
    const dropLng = Number(body.dropLng);

    const serviceType = (body.serviceType || "ride").toLowerCase();

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

    const tripKm = haversine(
      pickupLat,
      pickupLng,
      dropLat,
      dropLng
    );

    const SERVICE_CATEGORY_MAP = {
      ride: ["economy", "comfort", "xl", "premium", "women", "aletwende"],
      courier: ["delivery_car", "delivery_motorbike", "delivery_bicycle"],
      delivery: ["delivery_truck", "delivery_car", "delivery_motorbike", "delivery_bicycle"],
      delivery_truck: ["delivery_truck"],
      towing: ["towing"]
    };

    const categories = SERVICE_CATEGORY_MAP[serviceType] || [];

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
      if (!online[uid]) return;
      if (!online[uid].isOnline) return;
      if (online[uid].isBusy) return;
      if (!locations[uid]) return;
      if (!locations[uid].l) return;
      if (!d.vehicle) return;
      if (!d.vehicle.vehicleCategory) return;

      if (
        !Array.isArray(d.vehicle.services) ||
        !d.vehicle.services.includes(serviceType)
      ) return;

      const lat = Number(locations[uid].l[0]);
      const lng = Number(locations[uid].l[1]);

      if (isNaN(lat) || isNaN(lng)) return;

      const distance = haversine(pickupLat, pickupLng, lat, lng);
      if (distance > 7) return;

      drivers.push({
        uid,
        rating: Number(d.rating || 0),
        distance,
        vehicle: d.vehicle
      });
    });

    const hasCategory = (arrOrStr, value) =>
      Array.isArray(arrOrStr)
        ? arrOrStr.includes(value)
        : arrOrStr === value;

    const cards = [];

    for (const category of categories) {

      let matches = drivers.filter((x) => {

        if (serviceType === "ride") {
          if (category === "economy") return hasCategory(x.vehicle.vehicleCategory, "economy");
          if (category === "xl") return hasCategory(x.vehicle.vehicleCategory, "xl");
          if (category === "comfort") return hasCategory(x.vehicle.pricingCategory, "ride_comfort");
          if (category === "premium") return hasCategory(x.vehicle.pricingCategory, "ride_premium");
          if (category === "women") return hasCategory(x.vehicle.pricingCategory, "ride_women");
          if (category === "aletwende") return hasCategory(x.vehicle.pricingCategory, "ride_aletwende");
        }

        return hasCategory(x.vehicle.vehicleCategory, category);
      });

      matches.sort((a, b) => {
        if (a.distance !== b.distance) return a.distance - b.distance;
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

      let pricingKey;

      if (Array.isArray(best.vehicle.pricingCategory)) {
        pricingKey = best.vehicle.pricingCategory.find(p =>
          p.includes(category)
        );
      } else {
        pricingKey = best.vehicle.pricingCategory;
      }

      const pricingDoc = await db.collection("pricing").doc(pricingKey).get();

      let baseFare = 40;
      if (pricingDoc.exists) {
        const pdata = pricingDoc.data() || {};
        baseFare = pdata.baseFare || pdata.base || pdata.startingFare || 40;
      }

      const eta = Math.max(2, Math.round(best.distance * 2));
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