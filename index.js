const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const jwt = require("jsonwebtoken");
const cookieParser = require('cookie-parser');
const admin = require("firebase-admin");
const crypto = require("crypto");


const decoded = Buffer.from(process.env.FB_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);


admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});



function generateChefId() {
    const random = crypto
        .randomBytes(3)
        .toString("hex")
        .toUpperCase();

    return `CHEF-${random}`;
}


const app = express()
const port = process.env.PORT;

//middleware
app.use(express.json());
app.use(cors({
    origin: ['http://localhost:5173', 'https://email-password-auth-61ee5.web.app'],
    credentials: true
}));
app.use(cookieParser());

// token verification middleware
const verifyToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).send({ error: 'Unauthorized Access' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.decoded = decoded;
        next();
    } catch (err) {
        return res.status(401).send({ error: 'Invalid token' });
    }
};



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
        // await client.connect();

        // collections
        const db = client.db('local_chef_bazaar_data');
        const userCollections = db.collection('users');
        const mealCollections = db.collection('meals');
        const reviewCollections = db.collection('reviews');
        const favouriteCollections = db.collection('favourites');
        const userRequestCollection = db.collection('users-request');
        const orderCollection = db.collection('orders');
        const paymentCollections = db.collection('payments');

        // admin verification middleware
        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const user = await userCollections.findOne({ email: decodedEmail });
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: 'Forbidden Access' });
            }
            next();
        };
        // chef verification middleware
        const verifyChef = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const user = await userCollections.findOne({ email: decodedEmail });
            if (user?.role !== 'chef') {
                return res.status(403).send({ error: 'Forbidden Access' });
            }
            next();
        }

        //get all users api
        app.get('/users', verifyToken, verifyAdmin, async (_req, res) => {
            const cursor = await userCollections.find().toArray();
            res.send(cursor);
        });
        // get user role api
        app.get('/users-role/:email', async (req, res) => {
            const email = req.params.email;
            const result = await userCollections.findOne({ email });
            res.send(result);
        })
        // add user api
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
        // update user status api (for admin to block / unblock user)
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

        //jwt token generation api
        app.post('/get-token', async (req, res) => {
            const { email } = req.body;
            if (!email) return res.status(400).send({ message: 'Email is required' });

            const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1h' });

            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production" ? true : false,
                sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
                maxAge: 60 * 60 * 1000 // 1 hour
            });

            res.send({ token: token });
        });

        //get all users request api (for admin)
        app.get('/users-request', verifyToken, verifyAdmin, async (_req, res) => {
            const query = { requestStatus: 'pending' };
            const result = await userRequestCollection.find(query).sort({ requestTime: -1 }).toArray();
            res.send(result);
        });

        // add user request api (for chef or admin role request)
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

        // update user request status api (for admin to approve / reject request)
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

                //  if nothing updated
                if (updateRequest.modifiedCount === 0) {
                    return res.send({
                        success: false,
                        message: 'Request status not updated'
                    });
                }

                //  If approved → update user role
                if (requestStatus === 'approved') {
                    const user = await userCollections.findOne({ email: userEmail });

                    if (!user) {
                        return res.send({
                            success: false,
                            message: 'User not found'
                        });
                    }

                    // 👨 Chef request
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

                    //  Other role (admin / user etc.)
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

        // delete user request api
        app.delete('/users-request/:userEmail', async (req, res) => {
            const userEmail = req.params.userEmail;
            const user = await userRequestCollection.deleteOne({ userEmail });
            res.send(user);

        })

        // get all meals api
        app.get('/meals', async (_req, res) => {
            const result = await mealCollections.find().sort({ createdAt: -1 }).limit(6).toArray();
            res.send(result);
        });
        // get all meals with pagination and sorting
        app.get('/total-meals', async (req, res) => {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 9;
            const sortBy = req.query.sortBy || 'asc';
            // console.log(page, limit, sortBy);
            const skip = (page - 1) * limit;

            const meals = await mealCollections
                .find()
                .skip(skip)
                .limit(limit)
                .sort({ price: sortBy === 'asc' ? 1 : -1 })
                .toArray();

            const totalCount = await mealCollections.countDocuments();

            res.send({ meals, totalCount });
        });

        // get single meal details api
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
        // get meals by chef email api
        app.get('/my-meals/:userEmail', verifyToken, verifyChef, async (req, res) => {
            const decodedEmail = req.decoded.email;
            const userEmail = req.params.userEmail;
            if (decodedEmail !== userEmail) {
                return res.status(403).send({ error: 'Forbidden Access' });
            }
            const result = await mealCollections.find({ userEmail }).sort({ createdAt: -1 }).toArray();
            res.send(result);
        });
        // create meal api
        app.post('/meals', async (req, res) => {
            const meal = req.body;
            const result = await mealCollections.insertOne(meal);
            res.send(result);
        });
        // update meal api
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

        // delete meal api
        app.delete('/meals/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await mealCollections.deleteOne(query);
            res.send(result);
        })

        //get orders api (for admin to see all pending and accepted orders)
        app.get('/orders', async (_req, res) => {
            const query = { orderStatus: { $in: ['pending', 'accepted'] } };
            const result = await orderCollection.find(query).sort({ orderTime: -1 }).toArray();
            res.send(result);
        });

        // get my orders api (for user to see their own orders)
        app.get('/my-orders', verifyToken, async (req, res) => {
            const userEmail = req.decoded.email;
            const orders = await orderCollection
                .find({ userEmail })
                .sort({ orderTime: -1 })
                .toArray();

            res.send(orders);
        });

        // create order api
        app.post('/orders', async (req, res) => {
            const orders = req.body;
            const result = await orderCollection.insertOne(orders);
            res.send(result);
        });
        // update order status api
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

        // get payment details api
        app.get('/payments/:id', verifyToken, async (req, res) => {
            const userEmail = req.decoded.email;
            const id = req.params.id;
            const query = { userEmail, _id: new ObjectId(id) };
            const result = await paymentCollections.findOne(query);
            res.send(result);
        });
        // create checkout session api
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
        // payment success api to verify payment and update order and payment details in database
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

        // get total payment received api (for admin)
        app.get('/admin/total-payment', verifyToken, verifyAdmin, async (_req, res) => {


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

        //get admin order status count api
        app.get('/admin-order-status-count', verifyToken, verifyAdmin, async (_req, res) => {
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

        //get all reviews api
        app.get('/all-reviews', verifyToken, async (req, res) => {
            const userEmail = req.decoded.email;
            const result = await reviewCollections.find().sort({ date: -1 }).toArray();
            res.send(result);
        });
        // get reviews by meal id api
        app.get('/reviews/:mealId', async (req, res) => {
            const mealId = req.params.mealId;
            const query = { mealId };
            const result = await reviewCollections.find(query).sort({ date: -1 }).toArray();
            res.send(result);
        });
        // get reviews by user email api
        app.get('/myreviews/:userEmail', async (req, res) => {
            const userEmail = req.params.userEmail;
            if (!userEmail) {
                return res.status(400).send({ message: "User is required" });
            }
            else {
                const query = { userEmail };
                const result = await reviewCollections.find(query).sort({ date: -1 }).toArray();
                return res.send(result);
            }
        });
        // create review api
        app.post('/reviews', async (req, res) => {
            const review = req.body;
            const result = await reviewCollections.insertOne(review);
            res.send(result);
        });
        // update review api
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
        // delete review api
        app.delete('/my-reviews/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await reviewCollections.deleteOne(query);
            res.send(result);
        });

        //favourite related apis 
        app.get('/favourites/:userEmail', verifyToken, async (req, res) => {
            const decodedEmail = req.decoded.email;
            const userEmail = req.params.userEmail;
            if (decodedEmail !== userEmail) {
                return res.status(403).send({ error: 'Forbidden Access' });
            }
            const query = { userEmail };
            const result = await favouriteCollections.find(query).sort({ added_date: -1 }).toArray();
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



        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    }
    finally {
    }
}


app.get('/', (_req, res) => {
    res.send('Local Chef Bazaar Backend is Running')
})

run().catch(console.dir);

app.listen(port, () => {
    console.log(`Local Chef Bazaar app listening on port ${port}`)
})
