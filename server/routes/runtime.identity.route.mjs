import { Router } from "express";
import { identityHandler } from "./sim.runtime.routes.mjs";

const runtimeIdentityRouter = Router();

runtimeIdentityRouter.post("/api/sim/runtime/identity", identityHandler);
runtimeIdentityRouter.post("/identity", identityHandler);

export default runtimeIdentityRouter;
