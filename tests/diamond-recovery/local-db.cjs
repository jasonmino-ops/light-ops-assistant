'use strict';
// Explicit local-only fixture setup; no DATABASE_URL from the environment.
const assert=require('node:assert/strict'),pg=require('pg'),{PrismaClient}=require('@prisma/client'),{PrismaPg}=require('@prisma/adapter-pg');
const {manifest,createController}=require('../../lib/diamond-recovery/controller.cjs');
const {BASE_ENV,token,tokenHash,deviceId,gateFixture,gateRow}=require('./helpers.cjs');
const scope={tenantId:manifest.tenantId,storeId:manifest.storeId};
let admin,createdRole=false;const databases=[],connections=[];
async function clone(label) {
 const name='native_inventory_test_oneclick_'+label+'_'+Date.now().toString(36);assert(/^native_inventory_test_oneclick_[a-z0-9_]+$/.test(name));
 await admin.query('CREATE DATABASE '+name+' TEMPLATE native_inventory_test_whole_order');databases.push(name);
 const setup=new pg.Pool({host:'127.0.0.1',port:56431,user:'jason',database:name});await setup.query('GRANT USAGE ON SCHEMA public TO postgres');await setup.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO postgres');await setup.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres');await setup.query('GRANT USAGE ON SCHEMA native_inventory TO postgres');await setup.query('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA native_inventory TO postgres');await setup.query('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA native_inventory TO postgres');await setup.end();
 const pool=new pg.Pool({host:'127.0.0.1',port:56431,user:'postgres',database:name,max:2});const db=new PrismaClient({adapter:new PrismaPg(pool)});connections.push({db,pool});
 const t=token();await db.desktopDevice.create({data:{id:'cmvyx1jes000208l14t5vf9ur',...scope,installationIdHash:'ISOLATED',tokenHash:'ISOLATED-'+name,tokenIssuedAt:new Date(),tokenExpiresAt:new Date(Date.now()+3600000)}});
 await db.browserPosDevice.create({data:{id:'ISOLATED-ONECLICK-BROWSER',...scope,browserDeviceId:deviceId,tokenHash:tokenHash(t),tokenIssuedAt:new Date(),tokenExpiresAt:new Date(Date.now()+3600000),scopes:[]}});
 await db.v3PrintControlPlane.update({where:{storeId:scope.storeId},data:{ownerDeviceId:'cmvyx1jes000208l14t5vf9ur',ownerEpoch:2,leaseId:'ISOLATED-LEASE-'+name,leaseExpiresAt:new Date(Date.now()+3600000)}});
 const env={...BASE_ENV,DATABASE_URL:'postgresql://postgres@127.0.0.1:56431/'+name};const g=gateFixture(env,t);await db.operationLog.create({data:gateRow(g)});return {db,pool,t,env,g,controller:createController(db,{env})};
}async function start(){
 admin=new pg.Pool({host:'127.0.0.1',port:56431,user:'jason',database:'postgres'});
 const roles=await admin.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='postgres'");
 if(!roles.rows.length){await admin.query('CREATE ROLE postgres LOGIN NOSUPERUSER BYPASSRLS');createdRole=true;}else{assert.equal(roles.rows[0].rolsuper,false);assert.equal(roles.rows[0].rolbypassrls,true);}
}
async function stop(){for(const {db,pool} of connections){await db.$disconnect();await pool.end();}for(const name of databases)await admin.query('DROP DATABASE '+name);if(createdRole)await admin.query('DROP ROLE postgres');await admin.end();}
module.exports={start,clone,stop};
