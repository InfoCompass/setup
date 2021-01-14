'use strict'

var	Promise		= require('bluebird'),
	fs			= require('fs-extra'),
	path		= require('path'),
	MongoClient	= require('mongodb').MongoClient,
	request		= require('request-promise'),
	targetDir	= path.resolve(process.argv[2] || '.')



function tab(n)		{	process.stdout.write('\t'.repeat(typeof n == 'number' ? n : 0)) }

function ok(s)		{ 	s = s && ` (${s})` || ''; process.stdout.write(`\t\x1b[32m[ok]\x1b[0m${s}\n`) }
function warn(s) 	{ 	process.stdout.write('\t\x1b[33m['+(s||'failed')+']\x1b[0m\n')}
function info(s) 	{ 	process.stdout.write('\t\x1b[35m['+(s||'info')+']\x1b[0m\n')}
function error(s) 	{ 
						newline()
						process.stdout.write('\t\x1b[31m['+(s||'failed')+']\x1b[0m\n')
						newline()
					}
function newline(x)	{ 	process.stdout.write('\n'.repeat(x||1))}
function write(n,s)	{ 	tab(n); process.stdout.write(s||n) }


async function findFile(dir, regex){
	dir 	= dir || '.'
	regex 	= new RegExp(regex) 

	if(!fs.lstatSync(dir).isDirectory()) return []

	return 	Promise.resolve(fs.readdir(dir)) //wrap into bluebird promise
			.map( 		filename 	=> 	regex.exec(filename) 
										? [dir] 
										: findFile(path.join(dir, filename), regex)
			)
			.filter(	a			=> a.length != 0 )
			.then(		a			=> [].concat.apply([], a))
}


 async function getGitOriginUrl(dir){
	dir = dir || '.'

	var	config = path.join(dir, '.git', 'config') 

	if(!fs.existsSync(config)) return null

	return	Promise.resolve(fs.readFile(config, 'utf8'))
			.then( content => { var match = content.match(/\[remote "origin"]\s*url\s*=\s*([^\s]*)/); return  match && match[1] })
}


async function findGitRepository(dir, regex){
	dir = dir || '.'

	return 	Promise.resolve(findFile(dir, /^\.git$/))
			.filter( folder => getGitOriginUrl(folder).then( link => regex.exec(link)) )
}

async function findClients(dir){	return await findGitRepository(dir, /https:\/\/github.com\/InfoCompass\/client/) }
async function findBackends(dir){	return await findGitRepository(dir, /https:\/\/github.com\/InfoCompass\/backend/) }


function findErrors(requirements, obj, path){
	var errors = []

	if(typeof requirements 	!= 'object') 	return ( (obj === undefined) || (obj === "") ) ? [(path||'')+' missing'] : []
	if(typeof obj 			!= 'object') 	return [path+' not an object']
		
	for(var k in requirements){
		var e = findErrors(requirements[k], obj[k], (path||'')+'.'+k) 
		errors = errors.concat(e)
	}
	
	return errors
}




function Client(baseDir){

	this.baseDir 		= baseDir || '.'
	this.config 		= undefined
	this.repo			= {error: 'not checked'}
	this.customSkins	= []

	this.findGitRepository = async function(){

		var repos = await findClients(this.baseDir)

		if(repos.length == 0) 	this.error.repo = 'missing repo'
		if(repos.length >	1)	this.error.repo = "found multiple client repositories"

		this.repo = repos[0]

		return this.repos
	}

	this.findCustomSkins = async function(){
		var self = this

		if(this.repo.error) return []

		var custom_dir = path.join(this.repo,'custom')

		if(!fs.existsSync(custom_dir)) return []

		var files 		= 	await fs.readdir(custom_dir),
			custom_dirs = 	files
							.filter(file 	=> fs.lstatSync(path.join(custom_dir, file)).isDirectory())
							.map(	file	=> path.join(custom_dir, file))

		custom_dirs.forEach( custom_dir => self.customSkins.push(new CustomSkin(custom_dir)))

		return this.customSkins
	}

	this.check = async function(){
		await this.ready

		newline()
		write('Client – ' + this.baseDir)
		newline()
		write(''.padStart(('Client – ' + this.baseDir).length+1, '-'))
		newline()
		
		write(1,'1) Clone repository')
		this.repo.error
		?	warn(repo.error)
		:	ok()

		write(1,'2) Clone custom skin into '+this.baseDir+'/custom')

		this.customSkins.length == 0
		?	warn('no custom skins found')
		:	await Promise.each(this.customSkins,  customSkin => customSkin.check(2) )
	
		newline()
	}

	var self = this

	this.ready = Promise.all([
					this.findGitRepository()
					.then( () => self.findCustomSkins() )
				])
}






function CustomSkin(baseDir){
	this.baseDir 	= 	baseDir || '.'
	this.name		=	path.basename(this.baseDir)
	this.config		= 	{error: false}
	this.origin		=	{error: false}

	this.getOrigin = async function(){
		this.origin = (await getGitOriginUrl(this.baseDir)) || { error: 'Unable to detect origin'}
	}

	this.getConfig = async function(){
		var config_file = path.join(baseDir, 'config.json')

		if(!fs.existsSync(config_file)) return this.config.error = "missing config file"

		try{
			this.config = JSON.parse(fs.readFileSync(config_file, 'utf8'))
		} catch(e) {
			this.config = {error: e}
			return null
		}
			

		var requirements = 	{
								backendLocation : 		true,
								title:					true, 
								languages:				true,
								sharing:				true,
								map:				{
									center:				true,
									zoom:				true,
									minZoom:			true,
									maxZoom:			true,
									maxBounds:			true,
									maxClusterRadius:	true,
									tiles:				true,
								}	

							},
			nice_to_have =	{
								description:			true,
								statsLocation:			true,
								activeIconColor:		true,
								plainIconColor:			true,
								chatbot:				true,
								disableLists:			true,
								publicItems:			true,
							}

		

		var errors 		= findErrors(requirements, this.config),
			warnings 	= findErrors(nice_to_have, this.config)


		if(error.length) 		this.config.error 		= errors[0]
		if(warnings.length) 	this.config.warnings	= warnings


	}

	this.checkBackend = async function(indent){
		await this.ready

		var files 	= 	[
							'dpd.js',				
							'ic-item-config.js',
							'translations.json',
						],
			url		= this.config.backendLocation.replace(/\/$/, "")



		write(indent, 'api'.padEnd(36, '.'))

		await	request.get(this.config.backendLocation)
				.then( () => ok() )
				.catch( e => warn() )



		await 	Promise.each(
					files,
					file 	=> 	request.get(url+'/'+file)
								.then(
									() => { write(indent, file.padEnd(36, '.')), ok(); return true},
									() => { write(indent, file.padEnd(36, '.')), warn(); return false}
								)
				)

		write(indent, 'stats'.padEnd(36, '.'))

		await	request.get(this.config.statsLocation)
				.then( () => ok() )
				.catch( e => warn() )

	}

	this.checkMapTiles = async function(indent){
		await this.ready

		write(indent, 'map tiles'.padEnd(36, '.'))

		var url = 	this.config.map.tiles
					.replace('{s}', 'b')
					.replace('{x}', 1)
					.replace('{y}', 1)
					.replace('{z}', 10)

		await 	request.get(url)
				.then(
					()=> ok(), 
					()=> warn()
				)
	}


	this.checkTaxonomy = async function(indent){
		var taxonomy_file = path.join(baseDir, 'js/taxonomy.js')

		write(indent, 'taxonomy'.padEnd(36, '.'))

		fs.existsSync(taxonomy_file)
		? ok()
		: warn('missing js/taxonomy.js')
	}

	this.check = async function(indent){
		await this.ready

		indent = indent || 0

		newline()

		write(indent,this.name.padEnd(30,'-'))
		
		newline()

		write(indent+1,'Origin ')

		this.origin.error
		?	warn(this.origin.error)
		:	(write(this.origin), ok())


		write(indent+1,'Config ')

		this.config.error
		?	warn(this.config.error)
		:	ok()


		if(this.config.error) return null

		if(this.config.warnings) this.config.warnings.forEach( w => { tab(indent+1); info(w);})

		newline(2)

		await this.checkBackend(indent+1)
		await this.checkTaxonomy(indent+1)
		await this.checkMapTiles(indent+1)
	}


	this.ready 	= 	Promise.all([
						this.getOrigin(),
						this.getConfig()
					])
					.catch( e => { error(e); process.exit(1) }) 
}








//BACKEND



function Backend(baseDir){

	this.baseDir 	= baseDir
	this.repo		= {error: 'not checked'}
	this.config		= {error: 'not checked'}

	this.findGitRepository = async function(){

		var repos = await findBackends(this.baseDir)

		if(repos.length == 0) 	this.error.repo = 'missing repo'
		if(repos.length >	1)	this.error.repo = "found multiple backend repositories"

		this.repo = repos[0]

		return this.repos
	}

	this.getConfig = 	async function(){
		var config_file = path.join(baseDir, 'config', 'config.json')

		if(!fs.existsSync(config_file)) return this.config.error =  "missing config file"

		try{
			this.config = JSON.parse(fs.readFileSync(config_file, 'utf8'))
		} catch(e) {
			this.config.error = e
			return null
		}

		const requirements	=	{
									port: 	true,
									db: {
										host: 		true,
										port:		true,
										name:		true,
										credentials: {
											username:	true,
											password:	true
										}
									}
									
								}	

		const nice_to_have =	{
									title: 						true,
									googleTranslateApiKey: 		true,
									deepLApiKey:				true,
									translationSpreadsheetUrl: 	true,
									frontendUrl: 				true,

									mail: {
										host: 		true,
										port:		true,
										secure:		true,
										user:		true,
										pass:		true,
										from:		true,
									},
									publicApi:{
                						port: 		true
        							}
        						}

		

		var errors 		= findErrors(requirements, this.config),
			warnings 	= findErrors(nice_to_have, this.config)


		if(error.length) 		this.config.error 		= errors[0]
		if(warnings.length) 	this.config.warnings	= warnings
	}


	this.checkDb = async function(indent){
		await this.ready

		if(!this.config.db) throw "missing config.db"

		var connect_str	= ('mongodb://')
						+ (this.config.db.credentials.username || '')
						+ (this.config.db.credentials.username && this.config.db.credentials.password ? ':' : '') 
						+ encodeURIComponent(this.config.db.credentials.password || '')
						+ (this.config.db.credentials.username && '@' || '')
						+ (this.config.db.host || "127.0.0.1")
						+ (':')
						+ (this.config.db.port)
						+ ('/')
						+ (this.config.db.name)
		
		return	MongoClient.connect(
					connect_str, 
					{ 
						useNewUrlParser: 			true,
						useUnifiedTopology:			true,
						connectTimeoutMS: 			3000,
  						serverSelectionTimeoutMS: 	3000
					}
				)
				.then(	client 	=> { 
					client.close(); 
					ok(`(${this.config.db.host}:${this.config.db.port})`);					
				})
				.catch(	e		=> { 
					warn(e); 					
					write('\t'.repeat(indent) + 'Tried: ' + connect_str) 
				})
	}




	this.check = async function(){
		await this.ready

		var item_file = path.join(baseDir, 'dpd/public', 'ic-item-config.js'),
			translations_file = path.join(baseDir, 'dpd/public', 'translations.json')

		newline()
		write(`Backend - ${this.baseDir} (port: ${this.config.port})`)
		newline()
		write('-'.repeat(('Backend - '+this.baseDir).length))
		newline()

		write('\t1) Clone repository')
		this.repo.error
		?	warn(this.repo.error)
		:	ok()

		write('\t2) Setup config file')
		this.config.error
		?	warn(this.config.error)
		:	ok()

		if(this.config.error) return null

		if(this.config.warnings) this.config.warnings.forEach( w => { tab(1); info(w);})		

		newline(2)

		write('\t3) Setup item config')
		fs.existsSync(item_file)
		?	ok()
		:	warn("missing item config - npm run setup")

		write('\t4) Setup translations')
		fs.existsSync(translations_file)
		?	ok()
		:	warn("missing translations - npm start") 


		write(`\t5) Setup MongoDb`)		
		await 	this.checkDb(2)


		newline(4)

		write('\nSetup Webserver')
		write('-------------')
		write(1,'1) Setup domains for stats, api, www, meta')


	// console.log('\t1) Setup lets encrypt')
	// console.log('\t1) Anonymize logs')
	// console.log('\nImport Data')
	// console.log('-------------')

	// console.log('... reports')
	// console.log('... backups')
	}

	this.ready 	= 	Promise.all([
						this.findGitRepository(),
						this.getConfig()
					])
					.catch( e => { error(e); process.exit(1) })
}




async function checkClients(){

	newline()
	newline()
	write('## Checking Clients in '+targetDir)

	var client_dirs 	= await findClients(targetDir),
		clients			= client_dirs
						.map( client_dir => new Client(client_dir))

	if(client_dirs.length == 0) warn('no clients found')

	newline()

	return Promise.each( clients, client => client.check() )

}

async function checkBackends(){

	newline(2)
	write('## Checking Backends in '+targetDir)


	var backend_dirs	= await findBackends(targetDir),
		backends		= backend_dirs.map( backend_dir => new Backend(backend_dir) )


	if(backend_dirs.length == 0) warn('no backends found')

	newline()

	return Promise.each( backends, backend => backend.check() )
}

Promise.resolve()
.then(checkClients)
.then(checkBackends)
.then( () => {
	newline(5)
})
