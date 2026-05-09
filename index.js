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
   🚗 SAVE DRIVER VEHICLE
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

    let services = Array.isArray(body.services)
      ? body.services
      : [];

    const cargoType = val(body.cargoType).toLowerCase();
    const refrigerationType = val(body.refrigerationType).toLowerCase();

    const vehicleType = val(
      body.vehicleType || body.model
    ).toLowerCase();

    const imageUrls = body.imageUrls || {};

    let vehicleCategories = [];
    let pricingCategories = [];
    let maxSeats = 0;
    let tonnage = null;

    /* =======================================================
       🚗 CAR
    ======================================================= */
    if (type === "car") {

      const vehicleKey = `${brand}_${model}`
        .toLowerCase()
        .replace(/\s+/g, "_");

      const rulesDoc = await db
        .collection("vehicle_service_rules")
        .doc(vehicleKey)
        .get();

      if (rulesDoc.exists) {

        const rules = rulesDoc.data();

        const allowedRideCategories =
          rules.allowedRideCategories || [];

        const defaultRideCategory =
          rules.defaultRideCategory?.[0];

        vehicleCategories = [
          ...allowedRideCategories
        ];

        pricingCategories = allowedRideCategories.map(
          cat => `ride_${cat}`
        );

        if (defaultRideCategory) {

          const catDoc = await db
            .collection("ride_categories")
            .doc(defaultRideCategory)
            .get();

          if (catDoc.exists) {
            maxSeats =
              catDoc.data().maxPassengers || 4;
          }
        }
      }

      if (
        services.includes("courier") ||
        services.includes("delivery") ||
        services.includes("package")
      ) {

        vehicleCategories.push("delivery_car");
        pricingCategories.push("delivery_car");
      }
    }

    /* =======================================================
       🏍️ MOTORBIKE
    ======================================================= */
    if (type === "motorbike") {

      services = [
        "delivery",
        "courier",
        "package"
      ];

      vehicleCategories.push("delivery_motorbike");

      pricingCategories.push(
        "delivery_motorbike"
      );
    }

    /* =======================================================
       🚚 TRUCK
    ======================================================= */
    if (type === "truck") {

      services = [
        "delivery",
        "delivery_truck"
      ];

      const master = TRUCK_MASTER[vehicleType];

      if (!master) {
        return res.status(400).json({
          error: "Unknown truck type"
        });
      }

      tonnage = master.tonnage;

      vehicleCategories.push("delivery_truck");

      /* =======================================================
         TRUCK PRICING CATEGORY
      ======================================================= */

      if (refrigerationType === "refrigerated") {

        pricingCategories.push(
          `refrigerated_truck_${tonnage}ton`
        );

      } else if (cargoType === "open") {

        pricingCategories.push(
          `open_truck_${tonnage}ton`
        );

      } else {

        pricingCategories.push(
          `closed_truck_${tonnage}ton`
        );
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

      services = [
        "delivery",
        "courier",
        "package"
      ];

      vehicleCategories.push(
        "delivery_bicycle"
      );

      pricingCategories.push(
        "delivery_bicycle"
      );
    }

    /* =======================================================
       SAVE VEHICLE
    ======================================================= */
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

      vehicleLicense: val(
        imageUrls.vehicleLicense
      ),

      registrationCertificate: val(
        imageUrls.registrationCertificate
      )
    };

    await db.collection("drivers")
      .doc(uid)
      .set(
        {
          uid,

          updatedAt:
            admin.firestore.FieldValue.serverTimestamp(),

          registrationStep: 6,

          vehicle
        },
        { merge: true }
      );

    return res.json({
      success: true,
      vehicleCategories,
      pricingCategories
    });

  } catch (error) {

    return res.status(500).json({
      error: error.message
    });
  }
});

/* =======================================================
   HELPERS
======================================================= */

function haversine(lat1, lon1, lat2, lon2) {

  const R = 6371;

  const dLat =
    (lat2 - lat1) * Math.PI / 180;

  const dLon =
    (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;

  return R * (
    2 * Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )
  );
}

function calculateFare(baseFare, km) {

  return Math.round(
    baseFare + (km * 6)
  );
}

/* =======================================================
   🚚 GET TRUCK TITLE
======================================================= */
function buildTruckTitle(vehicle) {

  const tonnage =
    vehicle.tonnage || 1;

  if (
    vehicle.refrigerationType ===
    "refrigerated"
  ) {
    return `${tonnage} ton refrigerated truck`;
  }

  if (vehicle.cargoType === "open") {
    return `${tonnage} ton open truck`;
  }

  return `${tonnage} ton closed truck`;
}

/* =======================================================
   🚚 RECOMMENDATION ENGINE
======================================================= */
function isRecommendedTruck(
  vehicle,
  deliveryType
) {

  const refrigeration =
    vehicle.refrigerationType ===
    "refrigerated";

  const open =
    vehicle.cargoType === "open";

  if (deliveryType === "farm-produce") {
    return refrigeration;
  }

  if (deliveryType === "building-sand") {
    return open;
  }

  if (
    deliveryType ===
    "construction-material"
  ) {
    return open;
  }

  if (
    deliveryType ===
    "house-shifting"
  ) {
    return vehicle.tonnage >= 3;
  }

  if (deliveryType === "furniture") {
    return vehicle.tonnage >= 2;
  }

  if (deliveryType === "bulk-goods") {
    return vehicle.tonnage >= 3;
  }

  return false;
}

/* =======================================================
   🚕 GET RIDE OPTIONS
======================================================= */
app.post("/getRideOptions", async (req, res) => {

  try {

    const body = req.body || {};

    const pickupLat =
      Number(body.pickupLat);

    const pickupLng =
      Number(body.pickupLng);

    const dropLat =
      Number(body.dropLat);

    const dropLng =
      Number(body.dropLng);

    const serviceType =
      (body.serviceType || "ride")
      .toLowerCase();

    const kg =
      body.kg || "0-5kg";

    const deliveryType =
      body.deliveryType || "";

    const tripKm = haversine(
      pickupLat,
      pickupLng,
      dropLat,
      dropLng
    );

    let categories = [];

    /* =======================================================
       🚕 RIDE
    ======================================================= */
    if (serviceType === "ride") {

      categories = [
        "economy",
        "comfort",
        "premium",
        "women",
        "aletwende",
        "xl",
        "xxl"
      ];
    }

    /* =======================================================
       📦 COURIER / PACKAGE
    ======================================================= */
    if (
      serviceType === "courier" ||
      serviceType === "package"
    ) {

      categories = [
        "delivery_bicycle",
        "delivery_motorbike",
        "delivery_car"
      ];
    }

    /* =======================================================
       🏗️ DELIVERY (HARDWARE)
    ======================================================= */
    if (serviceType === "delivery") {

      categories = [
        "delivery_bicycle",
        "delivery_motorbike",
        "delivery_car",
        "delivery_truck"
      ];
    }

    /* =======================================================
       🚚 TRUCK DELIVERY
    ======================================================= */
    if (
      serviceType === "delivery_truck"
    ) {

      categories = [
        "delivery_truck"
      ];
    }

    /* =======================================================
       FETCH ONLINE DRIVERS
    ======================================================= */

    const onlineSnap = await rtdb
      .ref("drivers_online")
      .once("value");

    const locationSnap = await rtdb
      .ref("driver_locations")
      .once("value");

    const online =
      onlineSnap.val() || {};

    const locations =
      locationSnap.val() || {};

    const driversSnap =
      await db.collection("drivers").get();

    const drivers = [];

    driversSnap.forEach((doc) => {

      const d = doc.data() || {};

      const uid =
        d.uid || doc.id;

      if (!uid) return;

      if (!online[uid]?.isOnline) return;

      if (online[uid]?.isBusy) return;

      if (!locations[uid]?.l) return;

      if (!d.vehicle) return;

      if (
        !d.vehicle.services.includes(
          serviceType
        )
      ) return;

      const lat =
        Number(locations[uid].l[0]);

      const lng =
        Number(locations[uid].l[1]);

      const distance = haversine(
        pickupLat,
        pickupLng,
        lat,
        lng
      );

      if (distance > 7) return;

      drivers.push({
        uid,
        distance,
        vehicle: d.vehicle
      });
    });

    /* =======================================================
       SORT TRUCKS BY RECOMMENDATION
    ======================================================= */

    if (
      serviceType === "delivery_truck"
    ) {

      drivers.sort((a, b) => {

        const aRecommended =
          isRecommendedTruck(
            a.vehicle,
            deliveryType
          );

        const bRecommended =
          isRecommendedTruck(
            b.vehicle,
            deliveryType
          );

        if (
          aRecommended &&
          !bRecommended
        ) return -1;

        if (
          !aRecommended &&
          bRecommended
        ) return 1;

        return a.distance - b.distance;
      });
    }

    /* =======================================================
       RESPONSE CARDS
    ======================================================= */

    const cards = [];

    /* =======================================================
       🚚 DELIVERY_TRUCK
       RETURN ALL AVAILABLE TRUCKS
    ======================================================= */

    if (
      serviceType === "delivery_truck"
    ) {

      const truckDrivers = drivers.filter(
        d =>
          d.vehicle.vehicleCategory.includes(
            "delivery_truck"
          )
      );

      for (const match of truckDrivers) {

        const pricingKey =
          match.vehicle.pricingCategory[0];

        const pricingDoc = await db
          .collection("pricing")
          .doc(pricingKey)
          .get();

        let baseFare = 40;

        if (pricingDoc.exists) {

          baseFare =
            pricingDoc.data().baseFare || 40;
        }

        const eta = Math.max(
          2,
          Math.round(match.distance * 2)
        );

        const price = calculateFare(
          baseFare,
          tripKm
        );

        const recommended =
          isRecommendedTruck(
            match.vehicle,
            deliveryType
          );

        cards.push({

          category: "delivery_truck",

          title: buildTruckTitle(
            match.vehicle
          ),

          enabled: true,

          eta,

          price,

          image: "delivery_truck.png",

          recommended,

          tonnage:
            match.vehicle.tonnage || null,

          cargoType:
            match.vehicle.cargoType || "",

          refrigerationType:
            match.vehicle
              .refrigerationType || "",

          vehicleType:
            match.vehicle.type || "truck"
        });
      }

      return res.json(cards);
    }

    /* =======================================================
       🚚 DELIVERY (HARDWARE)
       LIMITED DELIVERY OPTIONS
    ======================================================= */

    if (serviceType === "delivery") {

      let bicycle =
        drivers.find(d =>
          d.vehicle.vehicleCategory.includes(
            "delivery_bicycle"
          )
        );

      let motorbike =
        drivers.find(d =>
          d.vehicle.vehicleCategory.includes(
            "delivery_motorbike"
          )
        );

      let car =
        drivers.find(d =>
          d.vehicle.vehicleCategory.includes(
            "delivery_car"
          )
        );

      let openTruck =
        drivers.find(
          d =>
            d.vehicle.type === "truck" &&
            d.vehicle.cargoType === "open"
        );

      let closedTruck =
        drivers.find(
          d =>
            d.vehicle.type === "truck" &&
            (
              d.vehicle.cargoType !==
              "open"
            )
        );

      const deliveryMatches = [
        {
          key: "delivery_bicycle",
          title: "Bicycle",
          match: bicycle
        },
        {
          key: "delivery_motorbike",
          title: "Motorbike",
          match: motorbike
        },
        {
          key: "delivery_car",
          title: "Car",
          match: car
        },
        {
          key: "open_truck",
          title: "Open Truck",
          match: openTruck
        },
        {
          key: "closed_truck",
          title: "Closed Truck",
          match: closedTruck
        }
      ];

      for (const item of deliveryMatches) {

        if (!item.match) {

          cards.push({
            category: item.key,
            title: item.title,
            enabled: false,
            eta: null,
            price: null,
            image: `${item.key}.png`
          });

          continue;
        }

        const pricingKey =
          item.match.vehicle.pricingCategory[0];

        const pricingDoc = await db
          .collection("pricing")
          .doc(pricingKey)
          .get();

        let baseFare = 40;

        if (pricingDoc.exists) {
          baseFare =
            pricingDoc.data().baseFare || 40;
        }

        const eta = Math.max(
          2,
          Math.round(item.match.distance * 2)
        );

        const price = calculateFare(
          baseFare,
          tripKm
        );

        let recommended = false;

        if (
          kg === "0-5kg" &&
          item.key === "delivery_bicycle"
        ) {
          recommended = true;
        }

        if (
          kg === "5-20kg" &&
          item.key ===
          "delivery_motorbike"
        ) {
          recommended = true;
        }

        if (
          kg === "20-100kg" &&
          item.key === "delivery_car"
        ) {
          recommended = true;
        }

        if (
          kg !== "0-5kg" &&
          kg !== "5-20kg" &&
          kg !== "20-100kg" &&
          (
            item.key === "open_truck" ||
            item.key === "closed_truck"
          )
        ) {
          recommended = true;
        }

        cards.push({

          category: item.key,

          title: item.title,

          enabled: true,

          eta,

          price,

          image: `${item.key}.png`,

          recommended
        });
      }

      cards.sort((a, b) => {
        return (
          (b.recommended === true) -
          (a.recommended === true)
        );
      });

      return res.json(cards);
    }

    /* =======================================================
       🚴 COURIER / PACKAGE / RIDE
    ======================================================= */

    for (const category of categories) {

      const match = drivers.find(
        d =>
          d.vehicle.vehicleCategory.includes(
            category
          )
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
        match.vehicle.pricingCategory.find(
          p => p.includes(category)
        ) ||
        match.vehicle.pricingCategory[0];

      const pricingDoc = await db
        .collection("pricing")
        .doc(pricingKey)
        .get();

      let baseFare = 40;

      if (pricingDoc.exists) {

        baseFare =
          pricingDoc.data().baseFare || 40;
      }

      const eta = Math.max(
        2,
        Math.round(match.distance * 2)
      );

      const price = calculateFare(
        baseFare,
        tripKm
      );

      let cleanTitle = category;

      if (
        category ===
        "delivery_bicycle"
      ) {
        cleanTitle = "Bicycle";
      }

      if (
        category ===
        "delivery_motorbike"
      ) {
        cleanTitle = "Motorbike";
      }

      if (
        category ===
        "delivery_car"
      ) {
        cleanTitle = "Car";
      }

      if (
        category ===
        "delivery_truck"
      ) {
        cleanTitle = "Truck";
      }

      cards.push({

        category,

        title: cleanTitle,

        enabled: true,

        eta,

        price,

        seats:
          serviceType === "ride"
            ? (match.vehicle.maxSeats || 4)
            : null,

        image: `${category}.png`
      });
    }

    return res.json(cards);

  } catch (error) {

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
  console.log(
    `Server running on port ${PORT}`
  );
});