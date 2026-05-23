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
   🔥 RATING HELPER FUNCTIONS
======================================================= */
/**
 * Calculate new weighted average rating
 * @param {number} currentRating - Current average rating
 * @param {number} currentReviewCount - Current number of reviews
 * @param {number} newRating - New rating to add (1-5)
 * @returns {number} - New weighted average rating
 */
function calculateNewAverageRating(currentRating, currentReviewCount, newRating) {
  // Handle edge case when reviewCount is 0
  if (currentReviewCount === 0) {
    return newRating;
  }
  
  // Weighted average formula: ((oldRating × oldReviewCount) + newRating) / newReviewCount
  const newReviewCount = currentReviewCount + 1;
  const totalRatingSum = (currentRating * currentReviewCount) + newRating;
  const newAverage = totalRatingSum / newReviewCount;
  
  // Round to 2 decimal places for cleaner storage
  return Math.round(newAverage * 100) / 100;
}

/**
 * Validate rating value
 * @param {number} rating - Rating to validate
 * @returns {boolean} - True if valid
 */
function isValidRating(rating) {
  return typeof rating === 'number' && rating >= 1 && rating <= 5;
}

/**
 * Check if order has already been rated by user
 * @param {string} orderId - Order ID
 * @param {string} type - 'driver' or 'store'
 * @returns {Promise<boolean>} - True if already rated
 */
async function isAlreadyRated(orderId, type) {
  try {
    const ratingDoc = await db
      .collection("ratings")
      .doc(orderId)
      .get();
    
    if (ratingDoc.exists) {
      const data = ratingDoc.data();
      if (type === 'driver' && data.driverRated) return true;
      if (type === 'store' && data.storeRated) return true;
    }
    return false;
  } catch (error) {
    console.log("isAlreadyRated error:", error);
    return false;
  }
}

/**
 * Mark order as rated for specific type
 * @param {string} orderId - Order ID
 * @param {string} type - 'driver' or 'store'
 * @param {Object} ratingData - Rating details to store
 */
async function markOrderAsRated(orderId, type, ratingData) {
  try {
    const ratingRef = db.collection("ratings").doc(orderId);
    const ratingDoc = await ratingRef.get();
    
    const updateData = {};
    if (type === 'driver') {
      updateData.driverRated = true;
      updateData.driverRating = ratingData.rating;
      updateData.driverFeedback = ratingData.feedback || '';
      updateData.driverRatedAt = now();
    } else if (type === 'store') {
      updateData.storeRated = true;
      updateData.storeRating = ratingData.rating;
      updateData.storeFeedback = ratingData.feedback || '';
      updateData.storeRatedAt = now();
    }
    
    updateData.updatedAt = now();
    
    if (ratingDoc.exists) {
      await ratingRef.update(updateData);
    } else {
      await ratingRef.set({
        orderId,
        ...updateData,
        createdAt: now()
      });
    }
  } catch (error) {
    console.log("markOrderAsRated error:", error);
    throw error;
  }
}

/* =======================================================
   🔥 RATINGS ENDPOINTS
======================================================= */

/* =======================================================
   POST /api/ratings/driver
   Submit rating for a driver
   Body: { driverId, orderId, rating, feedback }
======================================================= */
app.post("/api/ratings/driver", async (req, res) => {
  try {
    const body = req.body || {};
    const driverId = val(body.driverId);
    const orderId = val(body.orderId);
    const rating = Number(body.rating);
    const feedback = val(body.feedback);

    // Validation
    if (!driverId) {
      return res.status(400).json({
        success: false,
        error: "Missing driverId"
      });
    }

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: "Missing orderId"
      });
    }

    if (!isValidRating(rating)) {
      return res.status(400).json({
        success: false,
        error: "Rating must be a number between 1 and 5"
      });
    }

    // Check if order exists
    const orderRef = db.collection("orders").doc(orderId);
    const orderDoc = await orderRef.get();
    
    if (!orderDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Order not found"
      });
    }

    // Check if driver already rated for this order
    const alreadyRated = await isAlreadyRated(orderId, 'driver');
    if (alreadyRated) {
      return res.status(400).json({
        success: false,
        error: "Driver already rated for this order"
      });
    }

    // Get current driver document
    const driverRef = db.collection("drivers").doc(driverId);
    const driverDoc = await driverRef.get();

    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Driver not found"
      });
    }

    const driverData = driverDoc.data() || {};
    let currentRating = driverData.rating || 0;
    let currentReviewCount = driverData.reviewCount || 0;

    // Calculate new average rating
    const newRating = calculateNewAverageRating(currentRating, currentReviewCount, rating);
    const newReviewCount = currentReviewCount + 1;

    // Update driver document
    await driverRef.update({
      rating: newRating,
      reviewCount: newReviewCount,
      updatedAt: now()
    });

    // Store feedback in a subcollection (optional but good for analytics)
    if (feedback && feedback.trim().length > 0) {
      await driverRef.collection("reviews").add({
        orderId,
        rating,
        feedback: feedback.trim(),
        createdAt: now()
      });
    }

    // Mark order as rated for driver
    await markOrderAsRated(orderId, 'driver', { rating, feedback });

    // Also update the order to indicate driver rating is complete
    await orderRef.update({
      driverRated: true,
      driverRating: rating,
      driverRatingSubmittedAt: now()
    });

    console.log(`Driver ${driverId} rated ${rating} for order ${orderId}. New avg: ${newRating} (${newReviewCount} reviews)`);

    return res.json({
      success: true,
      data: {
        driverId,
        orderId,
        rating,
        newAverageRating: newRating,
        totalReviews: newReviewCount
      }
    });

  } catch (error) {
    console.error("Error in /api/ratings/driver:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =======================================================
   POST /api/ratings/store
   Submit rating for a store
   Body: { storeId, orderId, rating, feedback }
======================================================= */
app.post("/api/ratings/store", async (req, res) => {
  try {
    const body = req.body || {};
    const storeId = val(body.storeId);
    const orderId = val(body.orderId);
    const rating = Number(body.rating);
    const feedback = val(body.feedback);

    // Validation
    if (!storeId) {
      return res.status(400).json({
        success: false,
        error: "Missing storeId"
      });
    }

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: "Missing orderId"
      });
    }

    if (!isValidRating(rating)) {
      return res.status(400).json({
        success: false,
        error: "Rating must be a number between 1 and 5"
      });
    }

    // Check if order exists
    const orderRef = db.collection("orders").doc(orderId);
    const orderDoc = await orderRef.get();
    
    if (!orderDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Order not found"
      });
    }

    // Check if store already rated for this order
    const alreadyRated = await isAlreadyRated(orderId, 'store');
    if (alreadyRated) {
      return res.status(400).json({
        success: false,
        error: "Store already rated for this order"
      });
    }

    // Get current store document
    const storeRef = db.collection("stores").doc(storeId);
    const storeDoc = await storeRef.get();

    if (!storeDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Store not found"
      });
    }

    const storeData = storeDoc.data() || {};
    let currentRating = storeData.rating || 0;
    let currentReviewCount = storeData.reviewCount || 0;

    // Calculate new average rating
    const newRating = calculateNewAverageRating(currentRating, currentReviewCount, rating);
    const newReviewCount = currentReviewCount + 1;

    // Update store document
    await storeRef.update({
      rating: newRating,
      reviewCount: newReviewCount,
      updatedAt: now()
    });

    // Store feedback in a subcollection (optional but good for analytics)
    if (feedback && feedback.trim().length > 0) {
      await storeRef.collection("reviews").add({
        orderId,
        rating,
        feedback: feedback.trim(),
        createdAt: now()
      });
    }

    // Mark order as rated for store
    await markOrderAsRated(orderId, 'store', { rating, feedback });

    // Also update the order to indicate store rating is complete
    await orderRef.update({
      storeRated: true,
      storeRating: rating,
      storeRatingSubmittedAt: now()
    });

    console.log(`Store ${storeId} rated ${rating} for order ${orderId}. New avg: ${newRating} (${newReviewCount} reviews)`);

    return res.json({
      success: true,
      data: {
        storeId,
        orderId,
        rating,
        newAverageRating: newRating,
        totalReviews: newReviewCount
      }
    });

  } catch (error) {
    console.error("Error in /api/ratings/store:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =======================================================
   GET /api/ratings/driver/:driverId
   Get driver's rating and review count
======================================================= */
app.get("/api/ratings/driver/:driverId", async (req, res) => {
  try {
    const driverId = req.params.driverId;
    
    if (!driverId) {
      return res.status(400).json({
        success: false,
        error: "Missing driverId"
      });
    }

    const driverDoc = await db.collection("drivers").doc(driverId).get();
    
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Driver not found"
      });
    }

    const driverData = driverDoc.data() || {};
    
    return res.json({
      success: true,
      data: {
        driverId,
        rating: driverData.rating || 0,
        reviewCount: driverData.reviewCount || 0
      }
    });

  } catch (error) {
    console.error("Error in GET /api/ratings/driver/:driverId:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =======================================================
   GET /api/ratings/store/:storeId
   Get store's rating and review count
======================================================= */
app.get("/api/ratings/store/:storeId", async (req, res) => {
  try {
    const storeId = req.params.storeId;
    
    if (!storeId) {
      return res.status(400).json({
        success: false,
        error: "Missing storeId"
      });
    }

    const storeDoc = await db.collection("stores").doc(storeId).get();
    
    if (!storeDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Store not found"
      });
    }

    const storeData = storeDoc.data() || {};
    
    return res.json({
      success: true,
      data: {
        storeId,
        rating: storeData.rating || 0,
        reviewCount: storeData.reviewCount || 0
      }
    });

  } catch (error) {
    console.error("Error in GET /api/ratings/store/:storeId:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =======================================================
   GET /api/ratings/check-order/:orderId
   Check if an order has been rated
======================================================= */
app.get("/api/ratings/check-order/:orderId", async (req, res) => {
  try {
    const orderId = req.params.orderId;
    
    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: "Missing orderId"
      });
    }

    const ratingDoc = await db.collection("ratings").doc(orderId).get();
    
    if (!ratingDoc.exists) {
      return res.json({
        success: true,
        data: {
          orderId,
          driverRated: false,
          storeRated: false
        }
      });
    }

    const data = ratingDoc.data();
    
    return res.json({
      success: true,
      data: {
        orderId,
        driverRated: data.driverRated || false,
        storeRated: data.storeRated || false,
        driverRating: data.driverRating || null,
        storeRating: data.storeRating || null
      }
    });

  } catch (error) {
    console.error("Error in GET /api/ratings/check-order/:orderId:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

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

    if (
      !driverId ||
      !orderId
    ) {
      return;
    }

    await rtdb
      .ref(
        `driver_trip_requests/${driverId}/${orderId}`
      )
      .update({

        status,

        updatedAt:
          Date.now(),

        ...extra
      });

  } catch (error) {

    console.log(
      "updateDriverRequestStatus error",
      error
    );
  }
}

/* =======================================================
   🚚 MASTER TRUCK TABLE
======================================================= */
const TRUCK_MASTER = {

  h100: {
    tonnage: 1.5
  },

  canter: {
    tonnage: 2
  },

  dyna: {
    tonnage: 3
  },

  kia2700: {
    tonnage: 2.5
  },

  fuso: {
    tonnage: 5
  }
};

/* =======================================================
   🔥 DRIVER REQUEST CLEANUP ONLY
======================================================= */
async function removeDriverRequest(
  driverId,
  orderId
) {

  try {

    await rtdb
      .ref(
        `driver_trip_requests/${driverId}/${orderId}`
      )
      .remove();

  } catch (error) {

    console.log(
      "removeDriverRequest error",
      error
    );
  }
}

async function removeRequestFromAllDrivers(
  orderId
) {

  try {

    const requestSnap =
      await rtdb
        .ref(
          "driver_trip_requests"
        )
        .once("value");

    const requests =
      requestSnap.val() || {};

    for (
      const uid of Object.keys(
        requests
      )
    ) {

      await rtdb
        .ref(
          `driver_trip_requests/${uid}/${orderId}`
        )
        .remove();
    }

  } catch (error) {

    console.log(
      "removeRequestFromAllDrivers error",
      error
    );
  }
}

/* =======================================================
   🔥 TEST FIRESTORE ROUTE
======================================================= */
app.get(
  "/testfirestore",
  async (req, res) => {

    try {

      await db
        .collection("test")
        .doc("ping")
        .set({

          time:
            new Date()
              .toISOString()
        });

      return res.json({

        success: true
      });

    } catch (error) {

      return res
        .status(500)
        .json({

          error:
            error.message
        });
    }
  }
);

/* =======================================================
   🚗 SAVE DRIVER VEHICLE
======================================================= */
app.post(
  "/classifyVehicleAndSaveDriver",
  async (req, res) => {

    try {

      const body =
        req.body || {};

      const uid =
        val(body.uid);

      const type =
        val(body.type)
          .toLowerCase();

      if (
        !uid ||
        !type
      ) {

        return res
          .status(400)
          .json({

            error:
              "Missing uid or type"
          });
      }

      const brand =
        val(body.brand);

      const model =
        val(body.model);

      const productionYear =
        val(
          body.productionYear
        );

      const plateNumber =
        val(
          body.plateNumber
        );

      const color =
        val(body.color);

      let services =
        Array.isArray(
          body.services
        )
          ? body.services
          : [];

      const cargoType =
        val(
          body.cargoType
        ).toLowerCase();

      const refrigerationType =
        val(
          body.refrigerationType
        ).toLowerCase();

      const vehicleType =
        val(
          body.vehicleType ||
          body.model
        ).toLowerCase();

      const imageUrls =
        body.imageUrls || {};

      let vehicleCategories =
        [];

      let pricingCategories =
        [];

      let maxSeats = 0;

      let tonnage = null;

      if (
        type === "car"
      ) {

        const vehicleKey =
          `${brand}_${model}`
            .toLowerCase()
            .replace(
              /\s+/g,
              "_"
            );

        const rulesDoc =
          await db
            .collection(
              "vehicle_service_rules"
            )
            .doc(vehicleKey)
            .get();

        if (
          rulesDoc.exists
        ) {

          const rules =
            rulesDoc.data();

          const allowedRideCategories =
            rules.allowedRideCategories || [];

          const defaultRideCategory =
            rules.defaultRideCategory?.[0];

          vehicleCategories = [
            ...allowedRideCategories
          ];

          pricingCategories =
            allowedRideCategories.map(
              (cat) =>
                `ride_${cat}`
            );

          if (
            defaultRideCategory
          ) {

            const catDoc =
              await db
                .collection(
                  "ride_categories"
                )
                .doc(
                  defaultRideCategory
                )
                .get();

            if (
              catDoc.exists
            ) {

              maxSeats =
                catDoc.data()
                  .maxPassengers || 4;
            }
          }
        }

        if (

          services.includes(
            "courier"
          ) ||

          services.includes(
            "delivery"
          ) ||

          services.includes(
            "package"
          )

        ) {

          vehicleCategories.push(
            "delivery_car"
          );

          pricingCategories.push(
            "delivery_car"
          );
        }
      }

      if (
        type === "motorbike"
      ) {

        services = [

          "delivery",

          "courier",

          "package"
        ];

        vehicleCategories.push(
          "delivery_motorbike"
        );

        pricingCategories.push(
          "delivery_motorbike"
        );
      }

      if (
        type === "truck"
      ) {

        services = [

          "delivery",

          "delivery_truck"
        ];

        const master =
          TRUCK_MASTER[
            vehicleType
          ];

        if (
          !master
        ) {

          return res
            .status(400)
            .json({

              error:
                "Unknown truck type"
            });
        }

        tonnage =
          master.tonnage;

        vehicleCategories.push(
          "delivery_truck"
        );

        if (
          cargoType === "open"
        ) {

          vehicleCategories.push(
            "open_truck"
          );

          pricingCategories.push(
            "open_truck"
          );

          if (
            tonnage === 1.5
          ) {

            pricingCategories.push(
              "open_truck_1.5ton"
            );

          } else {

            pricingCategories.push(
              `open_truck_${tonnage}ton`
            );
          }

        } else {

          vehicleCategories.push(
            "closed_truck"
          );

          pricingCategories.push(
            "closed_truck"
          );

          if (

            refrigerationType ===
            "refrigerated"

          ) {

            pricingCategories.push(
              `refrigerated_truck_${tonnage}ton`
            );

          } else {

            pricingCategories.push(
              `enclosed_truck_${tonnage}ton`
            );
          }
        }

        if (

          refrigerationType ===
          "refrigerated"

        ) {

          pricingCategories.push(
            `refrigerated_truck_${tonnage}ton`
          );

        } else if (
          cargoType === "open"
        ) {

          pricingCategories.push(
            `open_truck_${tonnage}ton`
          );

        } else {

          pricingCategories.push(
            `enclosed_truck_${tonnage}ton`
          );
        }
      }

      if (
        type === "minibus"
      ) {

        services = [
          "ride"
        ];

        vehicleCategories.push(
          "xxl"
        );

        pricingCategories.push(
          "ride_xxl"
        );

        maxSeats = 10;
      }

      if (
        type === "bicycle"
      ) {

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

      vehicleCategories = [
        ...new Set(vehicleCategories)
      ];

      pricingCategories = [
        ...new Set(pricingCategories)
      ];

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

        vehicleCategory:
          vehicleCategories,

        pricingCategory:
          pricingCategories,

        maxSeats,

        carImage:
          val(
            imageUrls.carImage
          ),

        vehicleLicense:
          val(
            imageUrls.vehicleLicense
          ),

        registrationCertificate:
          val(
            imageUrls.registrationCertificate
          )
      };

      await db
        .collection("drivers")
        .doc(uid)
        .set(

          {

            uid,

            updatedAt:
              now(),

            registrationStep: 6,

            vehicle
          },

          {
            merge: true
          }
        );

      await rtdb
        .ref(
          `drivers/${uid}/vehicle`
        )
        .set(vehicle);

      return res.json({

        success: true,

        vehicleCategories,

        pricingCategories
      });

    } catch (error) {

      return res
        .status(500)
        .json({

          error:
            error.message
        });
    }
  }
);

/* =======================================================
   📍 DRIVER LOCATION UPDATE
======================================================= */
app.post(
  "/updateDriverLocation",
  async (req, res) => {

    try {

      const body =
        req.body || {};

      const driverId =
        val(body.driverId);

      const lat =
        Number(body.lat);

      const lng =
        Number(body.lng);

      if (
        !driverId
      ) {

        return res
          .status(400)
          .json({

            error:
              "Missing driverId"
          });
      }

      await rtdb
        .ref(
          `driver_locations/${driverId}`
        )
        .set({

          l: [lat, lng],

          lat,

          lng,

          updatedAt:
            Date.now()
        });

      await db
        .collection("drivers")
        .doc(driverId)
        .set({

          currentLocation: {

            lat,

            lng,

            updatedAt:
              now()
          }

        }, {
          merge: true
        });

      return res.json({

        success: true
      });

    } catch (error) {

      return res
        .status(500)
        .json({

          error:
            error.message
        });
    }
  }
);

/* =======================================================
   🔥 DRIVER ONLINE STATUS
======================================================= */
app.post(
  "/setDriverOnlineStatus",
  async (req, res) => {

    try {

      const body =
        req.body || {};

      const driverId =
        val(body.driverId);

      const isOnline =
        !!body.isOnline;

      if (
        !driverId
      ) {

        return res
          .status(400)
          .json({

            error:
              "Missing driverId"
          });
      }

      await rtdb
        .ref(
          `drivers_online/${driverId}`
        )
        .update({

          isOnline,

          updatedAt:
            Date.now()
        });

      await db
        .collection("drivers")
        .doc(driverId)
        .set({

          isOnline,

          updatedAt:
            now()

        }, {
          merge: true
        });

      return res.json({

        success: true
      });

    } catch (error) {

      return res
        .status(500)
        .json({

          error:
            error.message
        });
    }
  }
);

/* =======================================================
   📍 HAVERSINE
======================================================= */
function haversine(
  lat1,
  lon1,
  lat2,
  lon2
) {

  const R = 6371;

  const dLat =
    (
      lat2 - lat1
    ) *
    Math.PI / 180;

  const dLon =
    (
      lon2 - lon1
    ) *
    Math.PI / 180;

  const a =

    Math.sin(
      dLat / 2
    ) ** 2 +

    Math.cos(
      lat1 * Math.PI / 180
    ) *

    Math.cos(
      lat2 * Math.PI / 180
    ) *

    Math.sin(
      dLon / 2
    ) ** 2;

  return R * (

    2 *

    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )
  );
}

/* =======================================================
   💰 CALCULATE FARE
======================================================= */
function calculateFare(
  baseFare,
  km
) {

  return Math.round(
    baseFare + (km * 6)
  );
}

/* =======================================================
   🔥 FIND MATCHING DRIVER
======================================================= */
async function findMatchingDriver(
  orderData
) {

  try {

    const pickupLat =
      Number(
        orderData.pickupLat
      );

    const pickupLng =
      Number(
        orderData.pickupLng
      );

    const dispatchService =
      val(
        orderData.dispatchService
      );

    if (
      !dispatchService
    ) {

      return null;
    }

    const onlineSnap =
      await rtdb
        .ref(
          "drivers_online"
        )
        .once("value");

    const locationSnap =
      await rtdb
        .ref(
          "driver_locations"
        )
        .once("value");

    const online =
      onlineSnap.val() || {};

    const locations =
      locationSnap.val() || {};

    const driversSnap =
      await db
        .collection(
          "drivers"
        )
        .get();

    let matches = [];

    driversSnap.forEach(
      (doc) => {

        const d =
          doc.data() || {};

        const uid =
          d.uid || doc.id;

        if (!uid) return;

        if (
          !online[uid]
            ?.isOnline
        ) return;

        if (
          online[uid]
            ?.isBusy
        ) return;

        if (
          !locations[uid]
            ?.l
        ) return;

        if (
          !d.vehicle
        ) return;

        if (
          d.verificationStatus !==
          "approved"
        ) return;

        const pricing =
          d.vehicle
            ?.pricingCategory || [];

        const categories =
          d.vehicle
            ?.vehicleCategory || [];

        const matched =

          pricing.includes(
            dispatchService
          ) ||

          categories.includes(
            dispatchService
          );

        if (
          !matched
        ) return;

        const lat =
          Number(
            locations[
              uid
            ].l[0]
          );

        const lng =
          Number(
            locations[
              uid
            ].l[1]
          );

        const distance =
          haversine(

            pickupLat,

            pickupLng,

            lat,

            lng
          );

        if (
          distance > 15
        ) return;

        matches.push({

          uid,

          distance
        });
      }
    );

    matches.sort(
      (a, b) =>
        a.distance -
        b.distance
    );

    return matches[0] || null;

  } catch (error) {

    console.log(
      "findMatchingDriver error",
      error
    );

    return null;
  }
}

/* =======================================================
   🔥 SEND REQUEST TO DRIVER
======================================================= */
async function sendRequestToDriver(
  orderId,
  orderData,
  driverUid
) {

  try {

    const workflowType =
      val(
        orderData.workflowType
      );

    const payload = {

      orderId,

      workflowType,

      requestType:
        workflowType,

      status:
        "incoming_request",

      createdAt:
        admin
          .database
          .ServerValue
          .TIMESTAMP,

      expiresAt:
        Date.now() + 30000,

      data:
        orderData
    };

    await rtdb
      .ref(
        `driver_trip_requests/${driverUid}/${orderId}`
      )
      .set(payload);

    await rtdb
      .ref(
        `drivers_online/${driverUid}`
      )
      .update({

        currentRequest:
          orderId
      });

    console.log(
      `Request sent to driver ${driverUid}`
    );

  } catch (error) {

    console.log(
      "sendRequestToDriver error",
      error
    );
  }
}

/* =======================================================
   🔥 DISPATCH ORDER
======================================================= */
async function dispatchOrder(
  orderId,
  orderData
) {

  try {

    const workflowType =
      val(
        orderData.workflowType
      );

    if (
      workflowType ===
      "direct_trip"
    ) {

      await db
        .collection("orders")
        .doc(orderId)
        .update({

          driverStatus:
            "searching",

          dispatchStartedAt:
            now()
        });
    }

    if (
      workflowType ===
      "store_delivery" ||

      workflowType ===
      "delivery"
    ) {

      await db
        .collection("orders")
        .doc(orderId)
        .update({

          driverStatus:
            "searching",

          dispatchStartedAt:
            now()
        });
    }

    const matchedDriver =
      await findMatchingDriver(
        orderData
      );

    if (
      !matchedDriver
    ) {

      await db
        .collection("orders")
        .doc(orderId)
        .update({

          driverStatus:
            "no_driver_found"
        });

      return;
    }

    await db
      .collection("orders")
      .doc(orderId)
      .update({

        driverId:
          matchedDriver.uid
      });

    await sendRequestToDriver(

      orderId,

      {

        ...orderData,

        driverStatus:
          "searching"
      },

      matchedDriver.uid
    );

  } catch (error) {

    console.log(
      "dispatchOrder error",
      error
    );
  }
}

/* =======================================================
   🔥 CENTRALIZED UPDATE TRIP STATUS
   FRONTEND SYNCED VERSION
======================================================= */
app.post(
  "/updateTripStatus",
  async (req, res) => {

    try {

      const body =
        req.body || {};

      const orderId =
        val(body.orderId);

      const driverId =
        val(body.driverId);

      const status =
        val(body.status);

      if (
        !orderId ||
        !driverId ||
        !status
      ) {

        return res
          .status(400)
          .json({

            error:
              "Missing orderId, driverId or status"
          });
      }

      const allowedStatuses = [

        "accepted",

        "declined",

        "arrived",

        "started",

        "completed",

        "at_store",

        "picked_up",

        "delivered",

        "cancelled"
      ];

      if (
        !allowedStatuses.includes(
          status
        )
      ) {

        return res
          .status(400)
          .json({

            error:
              "Invalid status"
          });
      }

      const orderRef =
        db
          .collection("orders")
          .doc(orderId);

      const orderDoc =
        await orderRef.get();

      if (
        !orderDoc.exists
      ) {

        return res
          .status(404)
          .json({

            error:
              "Order not found"
          });
      }

      const orderData =
        orderDoc.data() || {};

      const workflowType =
        val(
          orderData.workflowType
        );

      /* =======================================================
         🔥 DECLINED
      ======================================================= */
      if (
        status === "declined"
      ) {

        await removeDriverRequest(
          driverId,
          orderId
        );

        await rtdb
          .ref(
            `drivers_online/${driverId}`
          )
          .update({

            currentRequest:
              null
          });

        return res.json({

          success: true
        });
      }

      /* =======================================================
         🔥 ACCEPTED
      ======================================================= */
      if (
        status === "accepted"
      ) {

        /* ---------------------------------------------------
           📦 FETCH DRIVER SNAPSHOT FROM DRIVERS COLLECTION
        --------------------------------------------------- */
        let driverSnapshot = {};

        try {

          const driverDoc =
            await db
              .collection("drivers")
              .doc(driverId)
              .get();

          if (
            driverDoc.exists
          ) {

            const driverData =
              driverDoc.data() || {};

            const profile =
              driverData.profile || {};

            const vehicle =
              driverData.vehicle || {};

            driverSnapshot = {

              firstName:
                val(
                  profile.firstName
                ),

              profilePicture:
                val(
                  profile.profilePicture
                ),

              rating:
                driverData.rating ?? 0,

              brand:
                val(
                  vehicle.brand
                ),

              carImage:
                val(
                  vehicle.carImage
                ),

              color:
                val(
                  vehicle.color
                ),

              model:
                val(
                  vehicle.model
                ),

              plateNumber:
                val(
                  vehicle.plateNumber
                )
            };
          }

        } catch (snapshotError) {

          console.log(
            "driverSnapshot fetch error",
            snapshotError
          );
        }

        /* ---------------------------------------------------
           🚗 DIRECT TRIP — accept immediately
        --------------------------------------------------- */
        if (

          workflowType ===
          "direct_trip"

        ) {

          await orderRef.update({

            driverId,

            status:
              "accepted",

            driverStatus:
              "assigned",

            acceptedAt:
              now(),

            updatedAt:
              now(),

            driverSnapshot
          });
        }

        /* ---------------------------------------------------
           🚚 STORE DELIVERY / DELIVERY — second accept
           (driverStatus must already be "searching")
        --------------------------------------------------- */
        if (

          workflowType ===
            "store_delivery" ||

          workflowType ===
            "delivery"

        ) {

          await orderRef.update({

            driverId,

            status:
              "driver_assigned",

            driverStatus:
              "assigned",

            acceptedAt:
              now(),

            updatedAt:
              now(),

            driverSnapshot
          });
        }

        await updateDriverRequestStatus(

          driverId,

          orderId,

          "accepted"
        );

        await rtdb
          .ref(
            `drivers_online/${driverId}`
          )
          .update({

            isBusy: true,

            currentTrip:
              orderId,

            currentRequest:
              null
          });

        const requestSnap =
          await rtdb
            .ref(
              "driver_trip_requests"
            )
            .once("value");

        const requests =
          requestSnap.val() || {};

        for (
          const uid of Object.keys(
            requests
          )
        ) {

          if (
            uid !== driverId
          ) {

            await rtdb
              .ref(
                `driver_trip_requests/${uid}/${orderId}`
              )
              .remove();
          }
        }

        return res.json({

          success: true
        });
      }

      /* =======================================================
         🔥 DRIVER VALIDATION
      ======================================================= */
      if (
        orderData.driverId !==
        driverId
      ) {

        return res
          .status(403)
          .json({

            error:
              "Driver mismatch"
          });
      }

      /* =======================================================
         🔥 ARRIVED
      ======================================================= */
      if (
        status === "arrived"
      ) {

        await orderRef.update({

          status:
            "arrived",

          driverStatus:
            "arrived",

          updatedAt:
            now()
        });

        await updateDriverRequestStatus(

          driverId,

          orderId,

          "arrived"
        );

        return res.json({

          success: true
        });
      }

      /* =======================================================
         🔥 STARTED
      ======================================================= */
      if (
        status === "started"
      ) {

        await orderRef.update({

          status:
            "started",

          driverStatus:
            "started",

          updatedAt:
            now()
        });

        await updateDriverRequestStatus(

          driverId,

          orderId,

          "started"
        );

        return res.json({

          success: true
        });
      }

      /* =======================================================
         🔥 AT STORE
      ======================================================= */
      if (
        status === "at_store"
      ) {

        await orderRef.update({

          status:
            "at_store",

          driverStatus:
            "at_store",

          updatedAt:
            now()
        });

        await updateDriverRequestStatus(

          driverId,

          orderId,

          "at_store"
        );

        return res.json({

          success: true
        });
      }

      /* =======================================================
         🔥 PICKED UP
      ======================================================= */
      if (
        status === "picked_up"
      ) {

        await orderRef.update({

          status:
            "picked_up",

          driverStatus:
            "picked_up",

          updatedAt:
            now()
        });

        await updateDriverRequestStatus(

          driverId,

          orderId,

          "picked_up"
        );

        return res.json({

          success: true
        });
      }

      /* =======================================================
         🔥 DELIVERED
      ======================================================= */
      if (
        status === "delivered"
      ) {

        await orderRef.update({

          status:
            "delivered",

          driverStatus:
            "delivered",

          updatedAt:
            now()
        });

        await updateDriverRequestStatus(

          driverId,

          orderId,

          "delivered"
        );

        return res.json({

          success: true
        });
      }

      /* =======================================================
         🔥 COMPLETED
      ======================================================= */
      if (
        status === "completed"
      ) {

        await orderRef.update({

          status:
            "completed",

          driverStatus:
            "completed",

          completedAt:
            now(),

          updatedAt:
            now()
        });

        await updateDriverRequestStatus(

          driverId,

          orderId,

          "completed"
        );

        await removeRequestFromAllDrivers(
          orderId
        );

        await rtdb
          .ref(
            `drivers_online/${driverId}`
          )
          .update({

            isBusy: false,

            currentTrip: null,

            currentRequest: null
          });

        return res.json({

          success: true
        });
      }

      /* =======================================================
         🔥 CANCELLED
      ======================================================= */
      if (
        status === "cancelled"
      ) {

        await orderRef.update({

          status:
            "cancelled",

          driverStatus:
            "cancelled",

          cancelledAt:
            now(),

          updatedAt:
            now()
        });

        await updateDriverRequestStatus(

          driverId,

          orderId,

          "cancelled"
        );

        await removeRequestFromAllDrivers(
          orderId
        );

        await rtdb
          .ref(
            `drivers_online/${driverId}`
          )
          .update({

            isBusy: false,

            currentTrip: null,

            currentRequest: null
          });

        return res.json({

          success: true
        });
      }

      return res
        .status(400)
        .json({

          error:
            "Unhandled status"
        });

    } catch (error) {

      console.log(
        "updateTripStatus error",
        error
      );

      return res
        .status(500)
        .json({

          error:
            error.message
        });
    }
  }
);

/* =======================================================
   🔥 FIRESTORE ORDERS LISTENER
======================================================= */
db.collection("orders")
  .onSnapshot(
    async (snapshot) => {

      for (
        const change of
        snapshot.docChanges()
      ) {

        const doc =
          change.doc;

        const data =
          doc.data() || {};

        const orderId =
          doc.id;

        const workflowType =
          val(
            data.workflowType
          );

        const status =
          val(
            data.status
          );

        const driverStatus =
          val(
            data.driverStatus
          );

        if (

          (
            change.type ===
            "added" ||

            change.type ===
            "modified"
          ) &&

          (
            workflowType ===
              "store_delivery" ||

            workflowType ===
              "delivery"
          ) &&

          status ===
            "ready_for_pickup" &&

          driverStatus ===
            "waiting"

        ) {

          console.log(
            "Starting store delivery dispatch"
          );

          await dispatchOrder(
            orderId,
            data
          );
        }

        if (

          (
            change.type ===
            "added" ||

            change.type ===
            "modified"
          ) &&

          workflowType ===
            "direct_trip" &&

          status ===
            "pending" &&

          driverStatus ===
            "waiting"

        ) {

          console.log(
            "Starting direct trip dispatch"
          );

          await dispatchOrder(
            orderId,
            data
          );
        }

        if (

          status ===
            "completed" ||

          status ===
            "cancelled"

        ) {

          if (
            data.driverId
          ) {

            await rtdb
              .ref(
                `drivers_online/${data.driverId}`
              )
              .update({

                isBusy: false,

                currentTrip:
                  null,

                currentRequest:
                  null
              });
          }

          await removeRequestFromAllDrivers(
            orderId
          );
        }
      }
    }
  );

/* =======================================================
   🚕 GET RIDE OPTIONS
======================================================= */
app.post(
  "/getRideOptions",
  async (req, res) => {

    try {

      const body =
        req.body || {};

      const pickupLat =
        Number(
          body.pickupLat
        );

      const pickupLng =
        Number(
          body.pickupLng
        );

      const dropLat =
        Number(
          body.dropLat
        );

      const dropLng =
        Number(
          body.dropLng
        );

      const serviceType =
        (
          body.serviceType ||
          "ride"
        ).toLowerCase();

      const tripKm =
        haversine(

          pickupLat,

          pickupLng,

          dropLat,

          dropLng
        );

      let categories =
        [];

      if (
        serviceType ===
        "ride"
      ) {

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

      if (

        serviceType ===
          "courier" ||

        serviceType ===
          "package"

      ) {

        categories = [

          "delivery_bicycle",

          "delivery_motorbike",

          "delivery_car"
        ];
      }

      if (
        serviceType ===
        "delivery"
      ) {

        categories = [

          "delivery_bicycle",

          "delivery_motorbike",

          "delivery_car",

          "open_truck",

          "closed_truck"
        ];
      }

      if (

        serviceType ===
          "delivery_truck"

      ) {

        categories = [
          "delivery_truck"
        ];
      }

      const onlineSnap =
        await rtdb
          .ref(
            "drivers_online"
          )
          .once("value");

      const locationSnap =
        await rtdb
          .ref(
            "driver_locations"
          )
          .once("value");

      const online =
        onlineSnap.val() || {};

      const locations =
        locationSnap.val() || {};

      const driversSnap =
        await db
          .collection(
            "drivers"
          )
          .get();

      const drivers = [];

      driversSnap.forEach(
        (doc) => {

          const d =
            doc.data() || {};

          const uid =
            d.uid || doc.id;

          if (!uid) return;

          if (
            !online[uid]
              ?.isOnline
          ) return;

          if (
            online[uid]
              ?.isBusy
          ) return;

          if (
            !locations[uid]
              ?.l
          ) return;

          if (
            !d.vehicle
          ) return;

          if (

            !d.vehicle
              .services
              .includes(
                serviceType
              )

          ) return;

          const lat =
            Number(
              locations[
                uid
              ].l[0]
            );

          const lng =
            Number(
              locations[
                uid
              ].l[1]
            );

          const distance =
            haversine(

              pickupLat,

              pickupLng,

              lat,

              lng
            );

          if (
            distance > 7
          ) return;

          drivers.push({

            uid,

            distance,

            vehicle:
              d.vehicle
          });
        }
      );

      const cards = [];

      const DISPLAY_NAMES = {

        delivery_car:
          "Car",

        delivery_motorbike:
          "Motorbike",

        delivery_bicycle:
          "Bicycle",

        open_truck:
          "Open Truck",

        closed_truck:
          "Closed Truck",

        economy:
          "Economy",

        comfort:
          "Comfort",

        premium:
          "Premium",

        xl:
          "XL",

        xxl:
          "XXL"
      };

      for (
        const category of categories
      ) {

        const match =
          drivers.find(

            (d) =>

              d.vehicle
                .vehicleCategory
                .includes(
                  category
                )
          );

        if (
          !match
        ) {

          cards.push({

            category,

            title:
              DISPLAY_NAMES[
                category
              ] || category,

            enabled:
              false,

            eta:
              null,

            price:
              null,

            seats:
              null,

            image:
              `${category}.png`
          });

          continue;
        }

        const pricingKey =
          match.vehicle
            .pricingCategory
            .find(

              (p) =>
                p.includes(
                  category
                )
            ) ||

          match.vehicle
            .pricingCategory[0];

        const pricingDoc =
          await db
            .collection(
              "pricing"
            )
            .doc(
              pricingKey
            )
            .get();

        let baseFare = 40;

        if (
          pricingDoc.exists
        ) {

          baseFare =
            pricingDoc.data()
              .baseFare || 40;
        }

        const eta =
          Math.max(

            2,

            Math.round(
              match.distance * 2
            )
          );

        const price =
          calculateFare(

            baseFare,

            tripKm
          );

        cards.push({

          category,

          title:
            DISPLAY_NAMES[
              category
            ] || category,

          dispatchService:
            pricingKey,

          pricingCategory:
            pricingKey,

          enabled:
            true,

          eta,

          price,

          seats:
            serviceType ===
            "ride"

              ? (
                match.vehicle
                  .maxSeats || 4
              )

              : null,

          image:
            `${category}.png`
        });
      }

      return res.json(
        cards
      );

    } catch (error) {

      return res
        .status(500)
        .json({

          error:
            error.message
        });
    }
  }
);

/* =======================================================
   HOME
======================================================= */
app.get(
  "/",
  (req, res) => {

    res.send(
      "Backend running 🚀"
    );
  }
);

/* =======================================================
   START SERVER
======================================================= */
const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  () => {

    console.log(
      `Server running on port ${PORT}`
    );
  }
);