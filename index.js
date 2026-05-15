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

      /* =======================================================
         🚗 CAR
      ======================================================= */
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

      /* =======================================================
         🏍️ MOTORBIKE
      ======================================================= */
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

      /* =======================================================
         🚚 TRUCK
      ======================================================= */
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

        /* =======================================================
           🚚 OPEN TRUCK
        ======================================================= */
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
        }

        /* =======================================================
           🚚 CLOSED TRUCK
        ======================================================= */
        else {

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

        /* =======================================================
           🚚 GENERIC DELIVERY TRUCK
        ======================================================= */
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

      /* =======================================================
         🚌 MINIBUS
      ======================================================= */
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

      /* =======================================================
         🚲 BICYCLE
      ======================================================= */
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

      /* =======================================================
         REMOVE DUPLICATES
      ======================================================= */
      vehicleCategories = [
        ...new Set(vehicleCategories)
      ];

      pricingCategories = [
        ...new Set(pricingCategories)
      ];

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
              admin
                .firestore
                .FieldValue
                .serverTimestamp(),

            registrationStep: 6,

            vehicle
          },

          {
            merge: true
          }
        );

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
   🚚 BUILD TRUCK TITLE
======================================================= */
function buildTruckTitle(
  vehicle
) {

  const tonnage =
    vehicle.tonnage || 1;

  if (

    vehicle
      .refrigerationType ===
    "refrigerated"

  ) {

    return `${tonnage} ton refrigerated truck`;
  }

  if (

    vehicle.cargoType ===
    "open"

  ) {

    return `${tonnage} ton open truck`;
  }

  return `${tonnage} ton closed truck`;
}

/* =======================================================
   🚚 TRUCK RECOMMENDATION
======================================================= */
function isRecommendedTruck(
  vehicle,
  deliveryType
) {

  const refrigeration =

    vehicle
      .refrigerationType ===
    "refrigerated";

  const open =

    vehicle.cargoType ===
    "open";

  if (

    deliveryType ===
    "farm-produce"

  ) {

    return refrigeration;
  }

  if (

    deliveryType ===
    "building-sand"

  ) {

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

    return (
      vehicle.tonnage >= 3
    );
  }

  if (

    deliveryType ===
    "furniture"

  ) {

    return (
      vehicle.tonnage >= 2
    );
  }

  if (

    deliveryType ===
    "bulk-goods"

  ) {

    return (
      vehicle.tonnage >= 3
    );
  }

  return false;
}

/* =======================================================
   🔥 FIND DRIVERS FOR REQUEST
======================================================= */
async function findDriversForRequest(
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

      return [];
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

    return matches;

  } catch (error) {

    console.log(
      "findDriversForRequest error",
      error
    );

    return [];
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
   🔥 DISPATCH STORE DELIVERY
======================================================= */
async function dispatchStoreDelivery(
  orderId,
  orderData
) {

  try {

    await db
      .collection("requests")
      .doc(orderId)
      .update({

        driverStatus:
          "searching",

        dispatchStartedAt:
          admin
            .firestore
            .FieldValue
            .serverTimestamp()
      });

    const drivers =
      await findDriversForRequest(
        orderData
      );

    if (
      !drivers.length
    ) {

      console.log(
        "No drivers found"
      );

      await db
        .collection("requests")
        .doc(orderId)
        .update({

          driverStatus:
            "no_driver_found"
        });

      return;
    }

    for (
      const driver of drivers
    ) {

      await sendRequestToDriver(

        orderId,

        orderData,

        driver.uid
      );
    }

    console.log(
      "Store delivery requests broadcasted"
    );

  } catch (error) {

    console.log(
      "dispatchStoreDelivery error",
      error
    );
  }
}

/* =======================================================
   🔥 DISPATCH DIRECT TRIP
======================================================= */
async function dispatchDirectTrip(
  orderId,
  orderData
) {

  try {

    await db
      .collection("requests")
      .doc(orderId)
      .update({

        driverStatus:
          "searching",

        dispatchStartedAt:
          admin
            .firestore
            .FieldValue
            .serverTimestamp()
      });

    const drivers =
      await findDriversForRequest(
        orderData
      );

    if (
      !drivers.length
    ) {

      console.log(
        "No drivers found"
      );

      await db
        .collection("requests")
        .doc(orderId)
        .update({

          driverStatus:
            "no_driver_found"
        });

      return;
    }

    for (
      const driver of drivers
    ) {

      await sendRequestToDriver(

        orderId,

        orderData,

        driver.uid
      );
    }

    console.log(
      "Direct trip requests broadcasted"
    );

  } catch (error) {

    console.log(
      "dispatchDirectTrip error",
      error
    );
  }
}

/* =======================================================
   🔥 DRIVER ACCEPT REQUEST
======================================================= */
app.post(
  "/acceptDriverRequest",
  async (req, res) => {

    try {

      const body =
        req.body || {};

      const orderId =
        val(body.orderId);

      const driverId =
        val(body.driverId);

      if (
        !orderId ||
        !driverId
      ) {

        return res
          .status(400)
          .json({

            error:
              "Missing orderId or driverId"
          });
      }

      const orderRef =
        db
          .collection("requests")
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

      if (

        orderData.driverId &&

        orderData.driverStatus ===
        "accepted"

      ) {

        return res.json({

          success: false,

          message:
            "Trip already accepted"
        });
      }

      const workflowType =
        val(
          orderData.workflowType
        );

      await orderRef.update({

        driverId,

        driverStatus:
          "accepted",

        status:

          workflowType ===
          "store_delivery"

            ? "driver_assigned"

            : "driver_assigned",

        acceptedAt:
          admin
            .firestore
            .FieldValue
            .serverTimestamp()
      });

      await rtdb
        .ref(
          `drivers_online/${driverId}`
        )
        .update({

          isBusy: true
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

        await rtdb
          .ref(
            `driver_trip_requests/${uid}/${orderId}`
          )
          .remove();
      }

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
   🔥 DRIVER DECLINE REQUEST
======================================================= */
app.post(
  "/declineDriverRequest",
  async (req, res) => {

    try {

      const body =
        req.body || {};

      const orderId =
        val(body.orderId);

      const driverId =
        val(body.driverId);

      if (
        !orderId ||
        !driverId
      ) {

        return res
          .status(400)
          .json({

            error:
              "Missing orderId or driverId"
          });
      }

      await rtdb
        .ref(
          `driver_trip_requests/${driverId}/${orderId}`
        )
        .remove();

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
   🔥 FIRESTORE REQUEST LISTENER
======================================================= */
db.collection("requests")
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

        /* =======================================================
           🏪 STORE DELIVERY
        ======================================================= */
        if (

          workflowType ===
          "store_delivery"

        ) {

          if (

            (
              change.type ===
              "added" ||

              change.type ===
              "modified"
            ) &&

            status ===
              "ready_for_pickup" &&

            driverStatus ===
              "waiting"

          ) {

            console.log(
              "Starting store dispatch"
            );

            await dispatchStoreDelivery(
              orderId,
              data
            );
          }
        }

        /* =======================================================
           🚕 DIRECT TRIP
        ======================================================= */
        if (

          workflowType ===
          "direct_trip"

        ) {

          if (

            (
              change.type ===
              "added" ||

              change.type ===
              "modified"
            ) &&

            status ===
              "pending" &&

            driverStatus ===
              "waiting"

          ) {

            console.log(
              "Starting direct trip dispatch"
            );

            await dispatchDirectTrip(
              orderId,
              data
            );
          }
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

      const kg =
        body.kg ||
        "0-5kg";

      const deliveryType =
        body.deliveryType || "";

      const tripKm =
        haversine(

          pickupLat,

          pickupLng,

          dropLat,

          dropLng
        );

      let categories =
        [];

      /* =======================================================
         🚕 RIDE
      ======================================================= */
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

      /* =======================================================
         📦 COURIER / PACKAGE
      ======================================================= */
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

      /* =======================================================
         🏗️ DELIVERY
      ======================================================= */
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

      /* =======================================================
         🚚 DELIVERY_TRUCK
      ======================================================= */
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
              category,

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

        let cleanTitle =
          category;

        if (

          category ===
          "delivery_bicycle"

        ) {

          cleanTitle =
            "Bicycle";
        }

        if (

          category ===
          "delivery_motorbike"

        ) {

          cleanTitle =
            "Motorbike";
        }

        if (

          category ===
          "delivery_car"

        ) {

          cleanTitle =
            "Car";
        }

        if (

          category ===
          "delivery_truck"

        ) {

          cleanTitle =
            "Truck";
        }

        cards.push({

          category,

          title:
            cleanTitle,

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