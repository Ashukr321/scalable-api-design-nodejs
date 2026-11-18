import { Router } from 'express';
import {
  listProducts,
  getProduct,
  createProduct,
  replaceProduct,
  updateProduct,
  deleteProduct,
} from '../controllers/product.controller.js';

// Express 5 forwards rejected promises to the error handler, so no try/catch or asyncHandler needed.
const router = Router();

router.route('/').get(listProducts).post(createProduct);
router.route('/:id').get(getProduct).put(replaceProduct).patch(updateProduct).delete(deleteProduct);

export default router;
