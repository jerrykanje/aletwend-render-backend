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
   🔥 BUILD DRIVER SNAPSHOT
   ✅ UPDATED
   ✅ USES ONLY firstName
   ✅ NO lastName
======================================================= */
async function buildDriverSnapshot(
  driverId
) {

  try {

    if (!driverId) {
      return null;
    }

    const driverDoc =
      await db
        .collection("drivers")
        .doc(driverId)
        .get();

    if (
      !driverDoc.exists
    ) {
      return null;
    }

    const driverData =
      driverDoc.data() || {};

    const vehicle =
      driverData.vehicle || {};

    return {

      uid:
        driverId,

      firstName:
        driverData.firstName || "",

      phone:
        driverData.phone || "",

      profileImage:
        driverData.profileImage || "",

      rating:
        driverData.rating || 0,

      vehicle: {

        brand:
          vehicle.brand || "",

        model:
          vehicle.model || "",

        color:
          vehicle.color || "",

        plateNumber:
          vehicle.plateNumber || "",

        type:
          vehicle.type || ""
      }
    };

  } catch (error) {

    console.log(
      "buildDriverSnapshot error",
      error
    );

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