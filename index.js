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

const rtdb =
  admin.database();

db.settings({
  ignoreUndefinedProperties: true
});

/* =======================================================
   🔥 CONSTANTS
======================================================= */
const REQUEST_TIMEOUT =
  30000;

const MAX_DRIVER_RADIUS_KM =
  15;

/* =======================================================
   HELPERS
======================================================= */
const val = (x) => x ?? "";

const now = () =>
  admin.firestore.FieldValue.serverTimestamp();

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
   🔥 CLEANUP
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

    const snap =
      await rtdb
        .ref(
          "driver_trip_requests"
        )
        .once("value");

    const data =
      snap.val() || {};

    for (
      const uid of Object.keys(
        data
      )
    ) {

      await removeDriverRequest(
        uid,
        orderId
      );
    }

  } catch (error) {

    console.log(
      "removeRequestFromAllDrivers error",
      error
    );
  }
}

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
   🔥 DRIVER ACKNOWLEDGEMENT FLOW
======================================================= */
app.post(
  "/driverRequestAcknowledgement",
  async (req, res) => {

    try {

      const body =
        req.body || {};

      const orderId =
        val(body.orderId);

      const driverId =
        val(body.driverId);

      const ackState =
        val(body.ackState);

      if (
        !orderId ||
        !driverId ||
        !ackState
      ) {

        return res
          .status(400)
          .json({

            error:
              "Missing orderId, driverId or ackState"
          });
      }

      const allowedStates = [

        "received",

        "viewed",

        "ringing"
      ];

      if (
        !allowedStates.includes(
          ackState
        )
      ) {

        return res
          .status(400)
          .json({

            error:
              "Invalid acknowledgement state"
          });
      }

      await updateDriverRequestStatus(

        driverId,

        orderId,

        ackState
      );

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
   🔥 FIND MATCHING DRIVERS
======================================================= */
async function findMatchingDrivers(
  orderData,
  excludedDrivers = []
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

    const dispatchCategory =
      val(
        orderData.dispatchCategory
      );

    if (
      !dispatchCategory
    ) {

      console.log(
        "Missing dispatchCategory"
      );

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
          excludedDrivers.includes(
            uid
          )
        ) return;

        if (
          !online[uid]
            ?.isOnline
        ) return;

        if (
          online[uid]
            ?.isBusy
        ) return;

        if (
          online[uid]
            ?.currentRequest
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
            dispatchCategory
          ) ||

          categories.includes(
            dispatchCategory
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
          distance >
          MAX_DRIVER_RADIUS_KM
        ) return;

        const rating =
          Number(
            d.rating || 5
          );

        matches.push({

          uid,

          rating,

          distance
        });
      }
    );

    matches.sort(
      (a, b) => {

        if (
          b.rating !==
          a.rating
        ) {

          return (
            b.rating -
            a.rating
          );
        }

        return (
          a.distance -
          b.distance
        );
      }
    );

    return matches;

  } catch (error) {

    console.log(
      "findMatchingDrivers error",
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

    const payload = {

      orderId,

      dispatchCategory:
        val(
          orderData.dispatchCategory
        ),

      workflowType:
        val(
          orderData.workflowType
        ),

      requestType:
        val(
          orderData.workflowType
        ),

      status:
        "incoming_request",

      acknowledgement:
        "sent",

      createdAt:
        admin.database
          .ServerValue
          .TIMESTAMP,

      expiresAt:
        Date.now() +
        REQUEST_TIMEOUT,

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
          orderId,

        requestSentAt:
          Date.now()
      });

    console.log(
      `Dispatch request sent to ${driverUid}`
    );

  } catch (error) {

    console.log(
      "sendRequestToDriver error",
      error
    );
  }
}

/* =======================================================
   🔥 DISPATCH LOCK
======================================================= */
async function acquireDispatchLock(
  orderId
) {

  const lockRef =
    db
      .collection("dispatch_locks")
      .doc(orderId);

  try {

    await db.runTransaction(
      async (tx) => {

        const lockDoc =
          await tx.get(
            lockRef
          );

        if (
          lockDoc.exists
        ) {

          throw new Error(
            "Dispatch already locked"
          );
        }

        tx.set(lockRef, {

          orderId,

          createdAt:
            now()
        });
      }
    );

    return true;

  } catch (error) {

    console.log(
      "acquireDispatchLock error",
      error.message
    );

    return false;
  }
}

async function releaseDispatchLock(
  orderId
) {

  try {

    await db
      .collection(
        "dispatch_locks"
      )
      .doc(orderId)
      .delete();

  } catch (error) {

    console.log(
      "releaseDispatchLock error",
      error
    );
  }
}

/* =======================================================
   🔥 REDISPATCH TIMER
======================================================= */
async function startDispatchTimeout(
  orderId,
  driverId
) {

  setTimeout(
    async () => {

      try {

        const orderRef =
          db
            .collection(
              "orders"
            )
            .doc(orderId);

        const orderDoc =
          await orderRef.get();

        if (
          !orderDoc.exists
        ) {
          return;
        }

        const orderData =
          orderDoc.data() || {};

        if (

          orderData.driverStatus ===
          "assigned"

        ) {
          return;
        }

        if (

          orderData.status ===
            "completed" ||

          orderData.status ===
            "cancelled"

        ) {
          return;
        }

        const requestSnap =
          await rtdb
            .ref(
              `driver_trip_requests/${driverId}/${orderId}`
            )
            .once("value");

        if (
          !requestSnap.exists()
        ) {
          return;
        }

        console.log(
          `Driver timeout ${driverId}`
        );

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

        await orderRef.update({

          dispatchState:
            "redispatching",

          updatedAt:
            now()
        });

        await redispatchOrder(
          orderId
        );

      } catch (error) {

        console.log(
          "startDispatchTimeout error",
          error
        );
      }

    },
    REQUEST_TIMEOUT
  );
}

/* =======================================================
   🔥 DISPATCH ORDER
======================================================= */
async function dispatchOrder(
  orderId,
  orderData
) {

  const lock =
    await acquireDispatchLock(
      orderId
    );

  if (!lock) {
    return;
  }

  try {

    const orderRef =
      db
        .collection(
          "orders"
        )
        .doc(orderId);

    const declinedDrivers =
      Array.isArray(
        orderData.declinedDrivers
      )

        ? orderData.declinedDrivers

        : [];

    const drivers =
      await findMatchingDrivers(

        orderData,

        declinedDrivers
      );

    if (
      !drivers.length
    ) {

      await orderRef.update({

        driverStatus:
          "no_driver_found",

        dispatchState:
          "failed",

        updatedAt:
          now()
      });

      await releaseDispatchLock(
        orderId
      );

      return;
    }

    const selectedDriver =
      drivers[0];

    await db.runTransaction(
      async (tx) => {

        const freshDoc =
          await tx.get(
            orderRef
          );

        if (
          !freshDoc.exists
        ) {

          throw new Error(
            "Order missing"
          );
        }

        const fresh =
          freshDoc.data() || {};

        if (

          fresh.driverStatus ===
          "assigned"

        ) {

          throw new Error(
            "Already assigned"
          );
        }

        tx.update(
          orderRef,
          {

            driverId:
              selectedDriver.uid,

            dispatchState:
              "searching",

            currentDispatchDriver:
              selectedDriver.uid,

            updatedAt:
              now(),

            dispatchStartedAt:
              now()
          }
        );
      }
    );

    await sendRequestToDriver(

      orderId,

      orderData,

      selectedDriver.uid
    );

    await startDispatchTimeout(

      orderId,

      selectedDriver.uid
    );

  } catch (error) {

    console.log(
      "dispatchOrder error",
      error
    );

  } finally {

    await releaseDispatchLock(
      orderId
    );
  }
}

/* =======================================================
   🔥 REDISPATCH
======================================================= */
async function redispatchOrder(
  orderId
) {

  try {

    const orderDoc =
      await db
        .collection("orders")
        .doc(orderId)
        .get();

    if (
      !orderDoc.exists
    ) {
      return;
    }

    const orderData =
      orderDoc.data() || {};

    if (

      orderData.status ===
        "completed" ||

      orderData.status ===
        "cancelled"

    ) {
      return;
    }

    if (

      orderData.driverStatus ===
      "assigned"

    ) {
      return;
    }

    await dispatchOrder(
      orderId,
      orderData
    );

  } catch (error) {

    console.log(
      "redispatchOrder error",
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
          .collection("orders")
          .doc(orderId);

      await db.runTransaction(
        async (tx) => {

          const orderDoc =
            await tx.get(
              orderRef
            );

          if (
            !orderDoc.exists
          ) {

            throw new Error(
              "Order not found"
            );
          }

          const order =
            orderDoc.data() || {};

          if (

            order.driverStatus ===
            "assigned"

          ) {

            if (
              order.driverId !==
              driverId
            ) {

              throw new Error(
                "Already assigned"
              );
            }

            return;
          }

          tx.update(
            orderRef,
            {

              driverId,

              status:
                "accepted",

              driverStatus:
                "assigned",

              acceptedAt:
                now(),

              updatedAt:
                now()
            }
          );
        }
      );

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

      await removeRequestFromAllDrivers(
        orderId
      );

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

      const orderRef =
        db
          .collection("orders")
          .doc(orderId);

      await db.runTransaction(
        async (tx) => {

          const orderDoc =
            await tx.get(
              orderRef
            );

          if (
            !orderDoc.exists
          ) {

            throw new Error(
              "Order not found"
            );
          }

          const order =
            orderDoc.data() || {};

          const declinedDrivers =
            Array.isArray(
              order.declinedDrivers
            )

              ? order.declinedDrivers

              : [];

          if (

            !declinedDrivers.includes(
              driverId
            )

          ) {

            declinedDrivers.push(
              driverId
            );
          }

          tx.update(
            orderRef,
            {

              declinedDrivers,

              updatedAt:
                now()
            }
          );
        }
      );

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

      await redispatchOrder(
        orderId
      );

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
   🔥 COMPLETE TRIP
======================================================= */
app.post(
  "/completeTrip",
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
          .collection("orders")
          .doc(orderId);

      const orderDoc =
        await orderRef.get();

      if (!orderDoc.exists) {

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

      await orderRef.update({

        status:
          "completed",

        driverStatus:
          "completed",

        completedAt:
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
   🔥 CANCEL TRIP
======================================================= */
app.post(
  "/cancelTrip",
  async (req, res) => {

    try {

      const body =
        req.body || {};

      const orderId =
        val(body.orderId);

      const driverId =
        val(body.driverId);

      if (
        !orderId
      ) {

        return res
          .status(400)
          .json({

            error:
              "Missing orderId"
          });
      }

      await db
        .collection("orders")
        .doc(orderId)
        .update({

          status:
            "cancelled",

          driverStatus:
            "cancelled",

          cancelledAt:
            now()
        });

      await removeRequestFromAllDrivers(
        orderId
      );

      if (
        driverId
      ) {

        await rtdb
          .ref(
            `drivers_online/${driverId}`
          )
          .update({

            isBusy: false,

            currentTrip: null,

            currentRequest: null
          });
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
   🔥 FIRESTORE ORDER LISTENER
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

        const dispatchState =
          val(
            data.dispatchState
          );

        if (

          dispatchState ===
          "searching"

        ) {
          continue;
        }

        if (

          (
            change.type ===
            "added" ||

            change.type ===
            "modified"
          ) &&

          workflowType ===
            "store_delivery" &&

          status ===
            "ready_for_pickup" &&

          driverStatus ===
            "waiting"

        ) {

          console.log(
            "Dispatching store delivery"
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
            "Dispatching direct trip"
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

            enabled:
              false
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

          dispatchCategory:
            pricingKey,

          enabled:
            true,

          eta,

          price,

          seats:
            match.vehicle
              .maxSeats || 4
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