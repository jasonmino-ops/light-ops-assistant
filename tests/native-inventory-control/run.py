"""Disposable loopback-only main-chain + Production-shaped migration tests.
No hosted credentials, no production I/O, no synthetic migration ledger writes.
"""
import json
import hashlib
import os
import pathlib
import shutil
import subprocess
import tempfile
import time
import urllib.request
import urllib.error

root = pathlib.Path(__file__).resolve().parents[2]
evidence = root / '.task-state/control-test-run'
evidence.mkdir(parents=True, exist_ok=True)
env = dict({key:os.environ[key] for key in ['PATH','HOME','TMPDIR','USER','SHELL','LANG','LC_ALL','CI','CONTROL_RUNTIME_ROOT'] if key in os.environ}, ESHOP_DISABLE_DEV_HEADERS='1', NATIVE_INVENTORY_ENABLED='true',
           TELEGRAM_BOT_TOKEN='inventory-control-fixture', AUTH_SECRET='inventory-control-fixture-secret',
           NATIVE_INVENTORY_TEST_DATABASE='1')
env['NATIVE_INVENTORY_PILOT_STORE_ID']='diamond-control-fixture'
env['INVENTORY_PROFIT_PILOT_STORE_ID']=''
port = '55451'
production_base='d1ffbaea3d01c219bfb45a99ea360c511f27cf36'
phase2_name='20261116130000_diamond_native_sales_phase2'
phase2_hash='91c3145cefe79556a10786b6ea1fd6ffa7cafe6d31fe56c04f67f5c14f330a7c'

def run(args, **kwargs):
    result = subprocess.run(args, cwd=root, env=kwargs.pop('env',env), text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed:\n{result.stdout}\n{result.stderr}')
    return result.stdout

def sql(database, query):
    return run(['psql','-X','-h','127.0.0.1','-p',port,'-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-tA'],input=query)

with tempfile.TemporaryDirectory(prefix='es-control-integration-') as temporary:
    tmp=pathlib.Path(temporary)
    data=tmp/'pgdata'
    socket=tmp/'socket'
    socket.mkdir()
    run(['initdb','-D',str(data),'-U','postgres','--auth=trust','-E','UTF8','--locale=C'])
    started=False
    try:
        run(['pg_ctl','-D',str(data),'-l',str(evidence/'postgres.log'),'-o',f'-k {socket} -p {port} -h 127.0.0.1','-w','start'])
        started=True
        sql('postgres','''CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
          CREATE ROLE eshop_native_inventory_app LOGIN; CREATE ROLE eshop_app_runtime LOGIN;
          CREATE ROLE eshop_native_inventory_access NOLOGIN;
          GRANT eshop_native_inventory_access TO eshop_app_runtime WITH INHERIT TRUE, SET FALSE;''')
        summary={'production_fixture_base':production_base,'phase2_sha256':phase2_hash,
                 'source_has_phase2':(root/'prisma/migrations'/phase2_name/'migration.sql').exists()}
        for mode in ['main','production']:
            database='native_inventory_test_control_'+mode
            sql('postgres',f'CREATE DATABASE {database}')
            migration_dir = root/'prisma/migrations'
            if mode=='production':
                migration_dir=evidence/'production-migrations'
                if migration_dir.exists(): shutil.rmtree(migration_dir)
                shutil.copytree(root/'prisma/migrations',migration_dir)
                phase2=migration_dir/phase2_name
                phase2.mkdir(exist_ok=True)
                existing=root/'prisma/migrations'/phase2_name/'migration.sql'
                phase2_sql=existing.read_text() if existing.exists() else run(['git','show',f'{production_base}:prisma/migrations/{phase2_name}/migration.sql'])
                assert hashlib.sha256(phase2_sql.encode()).hexdigest()==phase2_hash
                (phase2/'migration.sql').write_text(phase2_sql)
            config=evidence/f'{mode}.config.ts'
            config.write_text("import {defineConfig} from 'prisma/config'; export default defineConfig("+json.dumps({
                'schema':str(root/'prisma/schema.prisma'),'migrations':{'path':str(migration_dir)},
                'datasource':{'url':f'postgresql://postgres@127.0.0.1:{port}/{database}'}})+');\n')
            migration_log=run([str(root/'node_modules/.bin/prisma'),'migrate','deploy','--config',str(config)])
            (evidence/f'{mode}-migrations.log').write_text(migration_log)
            summary['source' if mode=='main' else mode]=json.loads(sql(database,'''SELECT json_build_object('applied',count(*) FILTER(WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
              'failed',count(*) FILTER(WHERE finished_at IS NULL AND rolled_back_at IS NULL)) FROM public._prisma_migrations;''').strip())
            if mode=='main':
                assert sql(database,"SELECT native_inventory.diamond_control_ready('absent','absent')").strip()=='f'
            else:
                sql(database,(root/'tests/fixtures/native-inventory-legacy-acl.sql').read_text())
                test_env=dict(env,DATABASE_URL=f'postgresql://eshop_app_runtime@127.0.0.1:{port}/{database}',
                  CONTROL_FIXTURE_OWNER_URL=f'postgresql://postgres@127.0.0.1:{port}/{database}')
                test_env['CONTROL_TEST_URL']='http://127.0.0.1:3251'
                with (evidence/'next-test.log').open('w') as log:
                    runtime_root=pathlib.Path(env.get('CONTROL_RUNTIME_ROOT',str(root))).resolve()
                    if runtime_root not in [root,pathlib.Path('/private/tmp/es-inventory-control-production-candidate')]:
                        raise RuntimeError('Unapproved test runtime path')
                    test_env['CONTROL_PRODUCTION_RUNTIME']='1' if (runtime_root/'prisma/migrations'/phase2_name/'migration.sql').exists() else '0'
                    server=subprocess.Popen([str(root/'node_modules/.bin/next'),'dev','--hostname','127.0.0.1','--port','3251'],cwd=runtime_root,env=test_env,stdout=log,stderr=log)
                    try:
                        for _ in range(90):
                            try: urllib.request.urlopen(test_env['CONTROL_TEST_URL']+'/api/native-inventory/sales-control',timeout=2); break
                            except urllib.error.HTTPError: break
                            except (urllib.error.URLError,TimeoutError): time.sleep(0.5)
                        else: raise RuntimeError('Loopback Next server not ready')
                        output=run([str(root/'node_modules/.bin/tsx'),'--test','tests/native-inventory-control/control.test.ts'],env=test_env)
                        (evidence/'control-tests.log').write_text(output)
                        print(output)
                    finally:
                        server.terminate()
                        try: server.wait(timeout=10)
                        except subprocess.TimeoutExpired: server.kill(); server.wait()
        summary['cleanup']='temporary cluster stopped and removed on exit'
        (evidence/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
        print(json.dumps(summary,indent=2))
    finally:
        if started: run(['pg_ctl','-D',str(data),'-m','fast','-w','stop'])
