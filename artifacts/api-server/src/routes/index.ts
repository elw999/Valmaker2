import { Router, type IRouter } from "express";
import healthRouter from "./health";
import importSkinsRouter from "./import-skins";
import membershipRouter from "./membership";
import otpRouter from "./otp";
import ecpayRouter from "./ecpay";
import pointsRouter from "./points";
import singleExportRouter from "./single-export";
import adminRouter from "./admin";
import templatesRouter from "./templates";
import canvasRouter from "./canvas";
import offerRouter from "./offer";
import productsRouter from "./products";
import transactionsRouter from "./transactions";
import messagesRouter from "./messages";
import profileRouter from "./profile";

const router: IRouter = Router();

router.use(healthRouter);
router.use(importSkinsRouter);
router.use(membershipRouter);
router.use(otpRouter);
router.use(ecpayRouter);
router.use(pointsRouter);
router.use(singleExportRouter);
router.use(adminRouter);
router.use(templatesRouter);
router.use(canvasRouter);
router.use(offerRouter);
router.use(productsRouter);
router.use(transactionsRouter);
router.use(messagesRouter);
router.use(profileRouter);

export default router;
