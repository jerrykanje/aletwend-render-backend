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
   🔥 FIND DRIVER FOR REQUEST
======================================================= */
async function findDriverForRequest(
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
      "findDriverForRequest error",
      error
    );

    return null;
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
          "searching"
      });

    const driver =
      await findDriverForRequest(
        orderData
      );

    if (
      !driver
    ) {

      console.log(
        "No driver found"
      );

      return;
    }

    await db
      .collection("requests")
      .doc(orderId)
      .update({

        driverId:
          driver.uid,

        driverStatus:
          "assigned",

        status:
          "driver_assigned"
      });

    await rtdb
      .ref(
        `drivers_online/${driver.uid}`
      )
      .update({

        isBusy: true
      });

    console.log(
      "Store delivery assigned"
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
          "searching"
      });

    const driver =
      await findDriverForRequest(
        orderData
      );

    if (
      !driver
    ) {

      console.log(
        "No driver found"
      );

      return;
    }

    await db
      .collection("requests")
      .doc(orderId)
      .update({

        driverId:
          driver.uid,

        driverStatus:
          "assigned"
      });

    await rtdb
      .ref(
        `drivers_online/${driver.uid}`
      )
      .update({

        isBusy: true
      });

    console.log(
      "Direct trip assigned"
    );

  } catch (error) {

    console.log(
      "dispatchDirectTrip error",
      error
    );
  }
}

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

        if (

          change.type !==
          "modified"

        ) {

          continue;
        }

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

      /* =======================================================
         🚚 DELIVERY_TRUCK
      ======================================================= */
      if (

        serviceType ===
        "delivery_truck"

      ) {

        drivers.sort(
          (a, b) => {

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

            ) {

              return -1;
            }

            if (

              !aRecommended &&

              bRecommended

            ) {

              return 1;
            }

            return (
              a.distance -
              b.distance
            );
          }
        );
      }

      const cards = [];

      /* =======================================================
         🚚 DELIVERY_TRUCK
      ======================================================= */
      if (

        serviceType ===
        "delivery_truck"

      ) {

        const truckDrivers =
          drivers.filter(

            (d) =>

              d.vehicle
                .vehicleCategory
                .includes(
                  "delivery_truck"
                )
          );

        for (
          const match of truckDrivers
        ) {

          let pricingKey =
            match.vehicle
              .pricingCategory
              .find(

                (p) =>

                  p.includes(
                    "truck_"
                  ) ||

                  p.includes(
                    "refrigerated_truck"
                  ) ||

                  p.includes(
                    "enclosed_truck"
                  ) ||

                  p.includes(
                    "open_truck_"
                  )
              );

          if (
            !pricingKey
          ) {

            pricingKey =
              match.vehicle
                .pricingCategory[0];
          }

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

          const recommended =
            isRecommendedTruck(

              match.vehicle,

              deliveryType
            );

          cards.push({

            category:
              "delivery_truck",

            title:
              buildTruckTitle(
                match.vehicle
              ),

            dispatchService:
              pricingKey,

            pricingCategory:
              pricingKey,

            enabled: true,

            eta,

            price,

            image:
              "delivery_truck.png",

            recommended,

            tonnage:
              match.vehicle
                .tonnage || null,

            cargoType:
              match.vehicle
                .cargoType || "",

            refrigerationType:
              match.vehicle
                .refrigerationType || "",

            vehicleType:
              match.vehicle
                .type || "truck"
          });
        }

        return res.json(
          cards
        );
      }

      /* =======================================================
         🚚 DELIVERY
      ======================================================= */
      if (
        serviceType ===
        "delivery"
      ) {

        let bicycle =
          drivers.find(

            (d) =>

              d.vehicle
                .vehicleCategory
                .includes(
                  "delivery_bicycle"
                )
          );

        let motorbike =
          drivers.find(

            (d) =>

              d.vehicle
                .vehicleCategory
                .includes(
                  "delivery_motorbike"
                )
          );

        let car =
          drivers.find(

            (d) =>

              d.vehicle
                .vehicleCategory
                .includes(
                  "delivery_car"
                )
          );

        let openTruck =
          drivers.find(

            (d) =>

              d.vehicle
                .vehicleCategory
                .includes(
                  "open_truck"
                )
          );

        let closedTruck =
          drivers.find(

            (d) =>

              d.vehicle
                .vehicleCategory
                .includes(
                  "closed_truck"
                )
          );

        const deliveryMatches = [

          {

            key:
              "delivery_bicycle",

            title:
              "Bicycle",

            dispatchService:
              "delivery_bicycle",

            pricingKey:
              "delivery_bicycle",

            match:
              bicycle
          },

          {

            key:
              "delivery_motorbike",

            title:
              "Motorbike",

            dispatchService:
              "delivery_motorbike",

            pricingKey:
              "delivery_motorbike",

            match:
              motorbike
          },

          {

            key:
              "delivery_car",

            title:
              "Car",

            dispatchService:
              "delivery_car",

            pricingKey:
              "delivery_car",

            match:
              car
          },

          {

            key:
              "open_truck",

            title:
              "Open Truck",

            dispatchService:
              "open_truck",

            pricingKey:
              "open_truck",

            match:
              openTruck
          },

          {

            key:
              "closed_truck",

            title:
              "Closed Truck",

            dispatchService:
              "closed_truck",

            pricingKey:
              "closed_truck",

            match:
              closedTruck
          }
        ];

        for (
          const item of deliveryMatches
        ) {

          if (
            !item.match
          ) {

            cards.push({

              category:
                item.key,

              title:
                item.title,

              enabled:
                false,

              eta:
                null,

              price:
                null,

              image:
                `${item.key}.png`
            });

            continue;
          }

          const pricingDoc =
            await db
              .collection(
                "pricing"
              )
              .doc(
                item.pricingKey
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
                item.match
                  .distance * 2
              )
            );

          const price =
            calculateFare(

              baseFare,

              tripKm
            );

          let recommended =
            false;

          if (

            kg ===
            "0-5kg" &&

            item.key ===
            "delivery_bicycle"

          ) {

            recommended =
              true;
          }

          if (

            kg ===
            "5-20kg" &&

            item.key ===
            "delivery_motorbike"

          ) {

            recommended =
              true;
          }

          if (

            kg ===
            "20-100kg" &&

            item.key ===
            "delivery_car"

          ) {

            recommended =
              true;
          }

          if (

            kg !==
              "0-5kg" &&

            kg !==
              "5-20kg" &&

            kg !==
              "20-100kg" &&

            (

              item.key ===
                "open_truck" ||

              item.key ===
                "closed_truck"

            )

          ) {

            recommended =
              true;
          }

          cards.push({

            category:
              item.key,

            title:
              item.title,

            dispatchService:
              item.dispatchService,

            pricingCategory:
              item.pricingKey,

            enabled:
              true,

            eta,

            price,

            image:
              `${item.key}.png`,

            recommended,

            cargoType:
              item.match
                .vehicle
                .cargoType || "",

            tonnage:
              item.match
                .vehicle
                .tonnage || null
          });
        }

        cards.sort(
          (a, b) => {

            return (

              (
                b.recommended ===
                true
              ) -

              (
                a.recommended ===
                true
              )
            );
          }
        );

        return res.json(
          cards
        );
      }

      /* =======================================================
         🚴 COURIER / PACKAGE / RIDE
      ======================================================= */
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