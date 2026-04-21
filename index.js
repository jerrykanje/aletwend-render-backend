 const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());

// Firebase init
admin.initializeApp({
  credential: admin.credential.cert(require("./serviceAccountKey.json"))
});

const db = admin.firestore();

// IMPORTANT
db.settings({
  ignoreUndefinedProperties: true
});

// helper
const val = (x) => x ?? "";

// 🔥 TEST FIRESTORE ROUTE (NEW)
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

// 🚗 MAIN ROUTE
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
    return res.status(500).json({
      error: error.message
    });
  }
});

// HOME
app.get("/", (req, res) => {
  res.send("Backend running 🚀");
});

// START SERVER (improved)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});