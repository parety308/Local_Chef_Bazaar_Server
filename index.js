const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const { customAlphabet } = require('nanoid');

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const nanoid = customAlphabet(alphabet, 4);

function generateChefId() {
    return `CHEF-${nanoid()}`;
}

const app = express()
const port = process.env.PORT;

//middleware
app.use(express.json());
app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
}));


const uri = process.env.URI;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();

        const db = client.db('local_chef_bazaar_data');
        const userCollections = db.collection('users');
        const mealCollections = db.collection('meals');
        const reviewCollections = db.collection('reviews');
        const favouriteCollections = db.collection('favourites');
        const userRequestCollection = db.collection('users-request');
        const orderCollection = db.collection('orders');
        const paymentCollections = db.collection('payments');

        //user related api
        app.get('/users', async (req, res) => {
            const cursor = await userCollections.find().toArray();
            res.send(cursor);
        });
        app.get('/users-role/:email', async (req, res) => {
            const email = req.params.email;
            const result = await userCollections.findOne({ email });
            res.send(result);
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            const email = user.email;
            const exictingUser = await userCollections.findOne({ email });
            if (exictingUser) {
                return res.status(409).send({ message: 'User already exists' });
            }
            else {
                const result = await userCollections.insertOne(user);
                return res.send(result);
            }
        });

        app.patch('/users/:email', async (req, res) => {
            const email = req.params.email;
            const { status } = req.body;
            const filter = { email };
            const updateDoc = {
                $set: {
                    status: status
                }
            };
            const result = await userCollections.updateOne(filter, updateDoc);
            res.send(result);
        });

        //user-request related apis
        app.get('/users-request', async (req, res) => {
            const query = { requestStatus: 'pending' };
            const result = await userRequestCollection.find(query).toArray();
            res.send(result);
        });
        app.post('/users-request', async (req, res) => {
            const userRequest = req.body;
            const exists = await userRequestCollection.findOne({
                userEmail: userRequest.userEmail,
                requestType: userRequest.requestType,
                requestStatus: "pending"
            });

            if (exists) {
                return res.send({ message: "Already requested" });
            }

            const result = await userRequestCollection.insertOne(userRequest);
            return res.send(result);

        });

        app.patch('/users-request/:userEmail', async (req, res) => {
            try {
                const userEmail = req.params.userEmail;
                const { requestStatus, requestType } = req.body;

                // 1️⃣ Update request status
                const updateRequest = await userRequestCollection.updateOne(
                    { userEmail },
                    {
                        $set: {
                            requestStatus: requestStatus
                        }
                    }
                );

                // ❌ if nothing updated
                if (updateRequest.modifiedCount === 0) {
                    return res.send({
                        success: false,
                        message: 'Request status not updated'
                    });
                }

                // 2️⃣ If approved → update user role
                if (requestStatus === 'approved') {
                    const user = await userCollections.findOne({ email: userEmail });

                    if (!user) {
                        return res.send({
                            success: false,
                            message: 'User not found'
                        });
                    }

                    // 👨‍🍳 Chef request
                    if (requestType === 'chef') {
                        const chefId = generateChefId();

                        const updateUser = await userCollections.updateOne(
                            { email: userEmail },
                            {
                                $set: {
                                    role: 'chef',
                                    chefId: chefId
                                }
                            }
                        );

                        return res.send({
                            success: true,
                            message: 'Chef request approved',
                            result: updateRequest,
                            userResult: updateUser
                        });
                    }

                    // 👤 Other role (admin / user etc.)
                    else {
                        const updateUser = await userCollections.updateOne(
                            { email: userEmail },
                            {
                                $set: {
                                    role: requestType
                                }
                            }
                        );

                        return res.send({
                            success: true,
                            message: 'Request approved',
                            result: updateRequest,
                            userResult: updateUser
                        });
                    }
                }

                // 3️⃣ If rejected
                if (requestStatus === 'rejected') {
                    return res.send({
                        success: true,
                        message: 'Request rejected',
                        result: updateRequest
                    });
                }

            } catch (error) {
                console.error(error);
                res.status(500).send({
                    success: false,
                    message: 'Server error'
                });
            }
        });


        app.delete('/users-request/:userEmail', async (req, res) => {
            const userEmail = req.params.userEmail;
            const user = await userRequestCollection.deleteOne({ userEmail });
            res.send(user);

        })

        //meals related apis
        app.get('/meals', async (req, res) => {
            const result = await mealCollections.find().toArray();
            res.send(result);
        });

        app.get('/meals/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                const result = await mealCollections.findOne(query);
                res.send(result);
            }
            catch (error) {
                res.status(500).send({ message: 'Server error', error: error.message });
            }
        });

        app.get('/my-meals/:userEmail', async (req, res) => {
            const userEmail = req.params.userEmail;
            const result = await mealCollections.find({ userEmail }).toArray();
            res.send(result);
        });

        app.post('/meals', async (req, res) => {
            const meal = req.body;
            const result = await mealCollections.insertOne(meal);
            res.send(result);
        });

        app.patch('/meals/:id', async (req, res) => {
            try {
                const id = req.params.id;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: "Invalid meal id" });
                }

                const query = { _id: new ObjectId(id) };

                const updateMeal = {
                    $set: {
                        mealName: req.body.mealName,
                        price: Number(req.body.price),
                        rating: Number(req.body.rating),
                        ingredients: req.body.ingredients,
                        estimatedDeliveryTime: Number(req.body.estimatedDeliveryTime),
                    }
                };

                const result = await mealCollections.updateOne(query, updateMeal);
                res.send(result);

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Internal server error" });
            }
        });


        app.delete('/meals/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await mealCollections.deleteOne(query);
            res.send(result);
        })

        //order related apis
        app.get('/orders', async (req, res) => {
            // const query = { orderStatus: 'pending' };
            const result = await orderCollection.find().toArray();
            res.send(result);
        })
        app.get('/orders/:userEmail', async (req, res) => {
            const userEmail = req.params.userEmail;
            const orders = await orderCollection.find({ userEmail }).toArray();
            res.send(orders);
        });

        app.post('/orders', async (req, res) => {
            const orders = req.body;
            const result = await orderCollection.insertOne(orders);
            res.send(result);
        });

        app.patch('/orders/:id', async (req, res) => {
            const id = req.params.id;
            const { orderStatus } = req.body;

            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    orderStatus: orderStatus
                }
            };

            const result = await orderCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        //payments related apis
        app.post('/create-checkout-session', async (req, res) => {
            const mealInfo = req.body;
            const amount = parseInt(mealInfo.price) * 100;
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount,
                            product_data: {
                                name: mealInfo.mealName
                            }
                        },
                        quantity: 1,
                    },
                ],
                customer_email: mealInfo.userEmail,
                mode: 'payment',
                metadata: {
                    orderId: mealInfo.orderId,
                    mealId: mealInfo.mealId,
                    mealName: mealInfo.mealName,
                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            });

            res.send({ url: session.url });
        });

        app.get('/payment-success', async (req, res) => {
            const sessionId = req.query.session_id;
            const session = await stripe.checkout.sessions.retrieve(sessionId);
            const transactionId = session.payment_intent;
            const queryExistingPayment = { transactionId: transactionId };
            const existingPayment = await paymentCollections.findOne(queryExistingPayment);

            if (existingPayment) {
                return res.send({
                    success: true,
                    message: "Payment Already Processed",
                    transactionId: transactionId
                });
            }
            if (session.payment_status === 'paid') {
                const orderId = session.metadata.orderId;
                const mealId = session.metadata.mealId;

                const updateResult = await orderCollection.updateOne(
                    { _id: new ObjectId(orderId) },
                    { $set: { paymentStatus: "paid" } }
                );



                const payment = {
                    amount: session.amount_total / 100,
                    transactionId,
                    currency: session.currency,
                    paymentStatus: session.payment_status,
                    userEmail: session.customer_email,
                    mealId,
                    orderId,
                    mealName: session.metadata.mealName,
                    paidAt: new Date(),
                };

                if (session.payment_status === 'paid') {
                    const paymentResult = await paymentCollections.insertOne(payment);
                    return res.send({
                        success: true,
                        modifyOrder: updateResult,
                        paymentInfo: paymentResult
                    })
                }
            }

            return res.send({ success: false });
        });

        //admin total payment api
        app.get('/admin/total-payment', async (req, res) => {
            try {
                const result = await paymentCollections.aggregate([
                    { $match: { paymentStatus: "paid" } },
                    {
                        $group: {
                            _id: null,
                            totalPayment: { $sum: "$amount" }
                        }
                    }
                ]).toArray();

                res.send({
                    totalPayment: result[0]?.totalPayment || 0
                });

            } catch (error) {
                res.status(500).send({
                    message: "Failed to calculate total payment"
                });
            }
        });

        //admin order status count api
        app.get('/admin-order-status-count', async (req, res) => {
            try {
                const result = await orderCollection.aggregate([
                    {
                        $group: {
                            _id: "$orderStatus",
                            count: { $sum: 1 }
                        }
                    }
                ]).toArray();

                let pending = 0;
                let delivered = 0;

                result.forEach(item => {
                    if (item._id === 'pending') pending = item.count;
                    if (item._id === 'delivered') delivered = item.count;
                });

                res.send({
                    pending,
                    delivered
                });

            } catch (error) {
                res.status(500).send({
                    message: "Failed to get order statistics"
                });
            }
        });






        //review related apis 
        app.get('/all-reviews', async (req, res) => {
            const result = await reviewCollections.find().toArray();
            res.send(result);
        });

        app.get('/reviews/:mealId', async (req, res) => {
            const mealId = req.params.mealId;
            const query = { mealId };
            const result = await reviewCollections.find(query).toArray();
            res.send(result);
        });

        app.get('/myreviews/:userEmail', async (req, res) => {
            const userEmail = req.params.userEmail;
            // console.log(userEmail)
            if (!userEmail) {
                return res.status(400).send({ message: "User is required" });
            }
            else {
                const query = { userEmail };
                const result = await reviewCollections.find(query).toArray();
                return res.send(result);
            }
        });

        app.post('/reviews', async (req, res) => {
            const review = req.body;
            const result = await reviewCollections.insertOne(review);
            res.send(result);
        });

        app.patch('/my-reviews/:id', async (req, res) => {
            const id = req.params.id;
            const { review, ratings } = req.body;
            const query = { _id: new ObjectId(id) };
            const updateRev = {
                $set: {
                    review,
                    ratings
                }
            }
            const result = await reviewCollections.updateOne(query, updateRev);
            res.send(result);
        });

        app.delete('/my-reviews/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await reviewCollections.deleteOne(query);
            res.send(result);
        });

        //favourite related apis 
        app.get('/favourites/:userEmail', async (req, res) => {
            const userEmail = req.params.userEmail;
            // console.log(userEmail);
            const query = { userEmail };
            // console.log(query);
            const result = await favouriteCollections.find(query).toArray();
            // console.log(result);
            res.send(result);
        });

        app.post('/favourites', async (req, res) => {
            const favourite = req.body;
            const mealId = req.body.mealId;
            // console.log(mealId);
            const exictingFav = await favouriteCollections.findOne({ mealId, userEmail: favourite.userEmail });
            if (exictingFav) {
                return res.status(400).send({ message: "Already exists" });
            }
            else {
                const result = await favouriteCollections.insertOne(favourite);
                return res.send(result);
            }
        });

        app.delete('/favourites/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await favouriteCollections.deleteOne(query);
            res.send(result);

        });

        //payment related apis



        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
    }
}


app.get('/', (req, res) => {
    res.send('Local Chef Bazaar Backend is Running')
})

run().catch(console.dir);

app.listen(port, () => {
    console.log(`Local Chef Bazaar app listening on port ${port}`)
})
