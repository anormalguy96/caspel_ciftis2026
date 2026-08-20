import { ProductConfig, ProductSlug } from '../types';
import en from '../locales/en.json';

export const PRODUCTS: Record<ProductSlug, ProductConfig> = {
  caspel: {
    slug: 'caspel',
    name: en.products.caspel.name,
    descriptor: en.products.caspel.descriptor,
    description: en.products.caspel.summary,
    presentationUrl: '/presentations/CASPEL_Corporate_Presentation.pdf',
    downloadFilename: en.products.caspel.downloadFilename,
    badge: '01',
    accentColor: '#0066cc',
  },
  erp: {
    slug: 'erp',
    name: en.products.erp.name,
    descriptor: en.products.erp.descriptor,
    description: en.products.erp.summary,
    presentationUrl: '/presentations/CASPEL_ERP_Presentation.pdf',
    downloadFilename: en.products.erp.downloadFilename,
    badge: '02',
    accentColor: '#0ea5e9',
  },
  pms: {
    slug: 'pms',
    name: en.products.pms.name,
    descriptor: en.products.pms.descriptor,
    description: en.products.pms.summary,
    presentationUrl: '/presentations/CASPEL_PMS_Presentation.pdf',
    downloadFilename: en.products.pms.downloadFilename,
    badge: '03',
    accentColor: '#3b82f6',
  },
  irissea: {
    slug: 'irissea',
    name: en.products.irissea.name,
    descriptor: en.products.irissea.descriptor,
    description: en.products.irissea.summary,
    presentationUrl: '/presentations/IRISSEA_LRIT_Presentation.pdf',
    downloadFilename: en.products.irissea.downloadFilename,
    badge: '04',
    accentColor: '#00c2ff',
  },
};

export const PRODUCT_LIST: ProductConfig[] = [
  PRODUCTS.caspel,
  PRODUCTS.erp,
  PRODUCTS.pms,
  PRODUCTS.irissea,
];
