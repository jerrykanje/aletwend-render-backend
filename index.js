const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());

/* =======================================================
   🔥 FIREBASE INIT
======================================================= */
const serviceAccount = JSON.parse(
  process.env.FIREBASE_KEY
);

admin.initializeApp({
  credential: admin.credential.cert(
    serviceAccount
  ),
  databaseURL:
    process.env.RTDB_URL
});

const db = admin.firestore();
const rtdb = admin.database();

db.settings({
  ignoreUndefinedProperties: true
});

/* =======================================================
   HELPERS
======================================================= */
const val = (x) => x ?? "";

const now = () =>
  admin.firestore.FieldValue.serverTimestamp();

/* =======================================================
   🔥 DRIVER SNAPSHOT BUILDER (NEW)
======================================================= */
async function buildDriverSnapshot(driverId) {
  try {
    if (!driverId) return null;

    const driverDoc = await db
      .collection("drivers")
      .doc(driverId)
      .get();

    if (!driverDoc.exists) return null;

    const d = driverDoc.data() || {};

    return {
      firstName: val(d.firstName),
      profilePicture: val(d.profilePicture),
      rating: val(d.rating),

      brand: val(d.vehicle?.brand),
      carImage: val(d.vehicle?.carImage),
      color: val(d.vehicle?.color),
      model: val(d.vehicle?.model),
      plateNumber: val(d.vehicle?.plateNumber)
    };

  } catch (error) {
    console.log("buildDriverSnapshot error", error);
    return null;
  }
}

/* =======================================================
   🔥 RTDB REQUEST STATUS SYNC
======================================================= */
async function updateDriverRequestStatus(
  driverId,
  orderId,
  status,
  extra = {}
) {
  try {
    if (!driverId || !orderId) return;

    await rtdb
      .ref(`driver_trip_requests/${driverId}/${orderId}`)
      .update({
        status,
        updatedAt: Date.now(),
        ...extra
      });

  } catch (error) {
    console.log("updateDriverRequestStatus error", error);
  }
}

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
   🔥 DRIVER REQUEST CLEANUP ONLY
======================================================= */
async function removeDriverRequest(driverId, orderId) {
  try {
    await rtdb
      .ref(`driver_trip_requests/${driverId}/${orderId}`)
      .remove();
  } catch (error) {
    console.log("removeDriverRequest error", error);
  }
}

async function removeRequestFromAllDrivers(orderId) {
  try {
    const requestSnap =
      await rtdb.ref("driver_trip_requests").once("value");

    const requests = requestSnap.val() || {};

    for (const uid of Object.keys(requests)) {
      await rtdb
        .ref(`driver_trip_requests/${uid}/${orderId}`)
        .remove();
    }

  } catch (error) {
    console.log("removeRequestFromAllDrivers error", error);
  }
}

/* =======================================================
   🔥 DISPATCH ORDER
======================================================= */
async function dispatchOrder(orderId, orderData) {
  try {
    const workflowType = val(orderData.workflowType);

    await db.collection("orders").doc(orderId).update({
      driverStatus: "searching",
      dispatchStartedAt: now()
    });

    const matchedDriver = await findMatchingDriver(orderData);

    if (!matchedDriver) {
      await db.collection("orders").doc(orderId).update({
        driverStatus: "no_driver_found"
      });
      return;
    }

    await db.collection("orders").doc(orderId).update({
      driverId: matchedDriver.uid
    });

    await sendRequestToDriver(
      orderId,
      { ...orderData, driverStatus: "searching" },
      matchedDriver.uid
    );

  } catch (error) {
    console.log("dispatchOrder error", error);
  }
}

/* =======================================================
   🔥 SEND REQUEST TO DRIVER
======================================================= */
async function sendRequestToDriver(orderId, orderData, driverUid) {
  try {

    const workflowType = val(orderData.workflowType);

    const payload = {
      orderId,
      workflowType,
      requestType: workflowType,
      status: "incoming_request",
      createdAt: admin.database.ServerValue.TIMESTAMP,
      expiresAt: Date.now() + 30000,
      data: orderData
    };

    await rtdb
      .ref(`driver_trip_requests/${driverUid}/${orderId}`)
      .set(payload);

    await rtdb
      .ref(`drivers_online/${driverUid}`)
      .update({
        currentRequest: orderId
      });

  } catch (error) {
    console.log("sendRequestToDriver error", error);
  }
}

/* =======================================================
   🚕 GET RIDE OPTIONS
======================================================= */
app.post("/getRideOptions", async (req, res) => {
  try {
    const body = req.body || {};

    const pickupLat = Number(body.pickupLat);
    const pickupLng = Number(body.pickupLng);
    const dropLat = Number(body.dropLat);
    const dropLng = Number(body.dropLng);

    const serviceType = (body.serviceType || "ride").toLowerCase();

    const tripKm = haversine(pickupLat, pickupLng, dropLat, dropLng);

    let categories = [];

    if (serviceType === "ride") {
      categories = ["economy","comfort","premium","women","aletwende","xl","xxl"];
    }

    if (serviceType === "courier" || serviceType === "package") {
      categories = ["delivery_bicycle","delivery_motorbike","delivery_car"];
    }

    const onlineSnap = await rtdb.ref("drivers_online").once("value");
    const locationSnap = await rtdb.ref("driver_locations").once("value");

    const online = onlineSnap.val() || {};
    const locations = locationSnap.val() || {};

    const driversSnap = await db.collection("drivers").get();

    const drivers = [];

    driversSnap.forEach((doc) => {
      const d = doc.data() || {};
      const uid = d.uid || doc.id;

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

    const cards = [];

    for (const category of categories) {
      const match = drivers.find((d) =>
        d.vehicle.vehicleCategory.includes(category)
      );

      if (!match) {
        cards.push({ category, enabled: false });
        continue;
      }

      const price = calculateFare(40, tripKm);

      cards.push({
        category,
        enabled: true,
        price,
        eta: Math.max(2, Math.round(match.distance * 2))
      });
    }

    return res.json(cards);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/* =======================================================
   🔥 UPDATE TRIP STATUS (UPDATED SNAPSHOT LOGIC HERE)
======================================================= */
app.post("/updateTripStatus", async (req, res) => {
  try {

    const body = req.body || {};
    const orderId = val(body.orderId);
    const driverId = val(body.driverId);
    const status = val(body.status);

    const orderRef = db.collection("orders").doc(orderId);
    const orderDoc = await orderRef.get();

    const orderData = orderDoc.data() || {};
    const workflowType = val(orderData.workflowType);

    /* =======================================================
       🔥 ACCEPTED (DIRECT + DELIVERY FIXED SNAPSHOT LOGIC)
    ======================================================= */
    if (status === "accepted") {

      /* DIRECT FLOW → IMMEDIATE ACCEPT */
      if (workflowType === "direct_trip") {

        const snapshot = await buildDriverSnapshot(driverId);

        await orderRef.update({
          driverId,
          status: "accepted",
          driverStatus: "assigned",
          driverSnapshot: snapshot,
          acceptedAt: now(),
          updatedAt: now()
        });
      }

      /* DELIVERY FLOW → SECOND ACCEPT (searching → accepted) */
      if (
        workflowType === "delivery" ||
        workflowType === "store_delivery"
      ) {

        const snapshot = await buildDriverSnapshot(driverId);

        await orderRef.update({
          driverId,
          status: "driver_assigned",
          driverStatus: "assigned",
          driverSnapshot: snapshot,
          acceptedAt: now(),
          updatedAt: now()
        });
      }

      await rtdb.ref(`drivers_online/${driverId}`).update({
        isBusy: true,
        currentTrip: orderId,
        currentRequest: null
      });

      return res.json({ success: true });
    }

    return res.json({ success: true });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/* =======================================================
   📍 HAVERSINE
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

/* =======================================================
   💰 CALCULATE FARE
======================================================= */
function calculateFare(baseFare, km) {
  return Math.round(baseFare + (km * 6));
}

/* =======================================================
   START SERVER
======================================================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});