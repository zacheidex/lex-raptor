import type { NextConfig } from 'next';
const config:NextConfig={
  output:'standalone',
  async rewrites(){return [{source:'/api/:path*',destination:`${process.env.API_INTERNAL_URL || 'http://127.0.0.1:8000'}/api/:path*`}];},
  async headers(){return [{source:'/:path*',headers:[
    {key:'X-Frame-Options',value:'DENY'},
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'Referrer-Policy',value:'no-referrer'},
    {key:'Content-Security-Policy',value:"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"}
  ]}];}
};
export default config;
