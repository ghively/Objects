const entries = [
  {
    key: 'application/andrew-inset',
    extensions: ['ez'],
  },
  {
    key: 'application/appinstaller',
    extensions: ['appinstaller'],
  },
  {
    key: 'application/applixware',
    extensions: ['aw'],
  },
  {
    key: 'application/appx',
    extensions: ['appx'],
  },
  {
    key: 'application/appxbundle',
    extensions: ['appxbundle'],
  },
  {
    key: 'application/atom+xml',
    extensions: ['atom'],
  },
  {
    key: 'application/atomcat+xml',
    extensions: ['atomcat'],
  },
  {
    key: 'application/atomdeleted+xml',
    extensions: ['atomdeleted'],
  },
  {
    key: 'application/atomsvc+xml',
    extensions: ['atomsvc'],
  },
  {
    key: 'application/atsc-dwd+xml',
    extensions: ['dwd'],
  },
  {
    key: 'application/atsc-held+xml',
    extensions: ['held'],
  },
  {
    key: 'application/atsc-rsat+xml',
    extensions: ['rsat'],
  },
  {
    key: 'application/automationml-aml+xml',
    extensions: ['aml'],
  },
  {
    key: 'application/automationml-amlx+zip',
    extensions: ['amlx'],
  },
  {
    key: 'application/bdoc',
    extensions: ['bdoc'],
  },
  {
    key: 'application/calendar+xml',
    extensions: ['xcs'],
  },
  {
    key: 'application/ccxml+xml',
    extensions: ['ccxml'],
  },
  {
    key: 'application/cdfx+xml',
    extensions: ['cdfx'],
  },
  {
    key: 'application/cdmi-capability',
    extensions: ['cdmia'],
  },
  {
    key: 'application/cdmi-container',
    extensions: ['cdmic'],
  },
  {
    key: 'application/cdmi-domain',
    extensions: ['cdmid'],
  },
  {
    key: 'application/cdmi-object',
    extensions: ['cdmio'],
  },
  {
    key: 'application/cdmi-queue',
    extensions: ['cdmiq'],
  },
  {
    key: 'application/cpl+xml',
    extensions: ['cpl'],
  },
  {
    key: 'application/cu-seeme',
    extensions: ['cu'],
  },
  {
    key: 'application/cwl',
    extensions: ['cwl'],
  },
  {
    key: 'application/dash+xml',
    extensions: ['mpd'],
  },
  {
    key: 'application/dash-patch+xml',
    extensions: ['mpp'],
  },
  {
    key: 'application/davmount+xml',
    extensions: ['davmount'],
  },
  {
    key: 'application/docbook+xml',
    extensions: ['dbk'],
  },
  {
    key: 'application/dssc+der',
    extensions: ['dssc'],
  },
  {
    key: 'application/dssc+xml',
    extensions: ['xdssc'],
  },
  {
    key: 'application/ecmascript',
    extensions: ['ecma'],
  },
  {
    key: 'application/emma+xml',
    extensions: ['emma'],
  },
  {
    key: 'application/emotionml+xml',
    extensions: ['emotionml'],
  },
  {
    key: 'application/epub+zip',
    extensions: ['epub'],
  },
  {
    key: 'application/exi',
    extensions: ['exi'],
  },
  {
    key: 'application/express',
    extensions: ['exp'],
  },
  {
    key: 'application/fdf',
    extensions: ['fdf'],
  },
  {
    key: 'application/fdt+xml',
    extensions: ['fdt'],
  },
  {
    key: 'application/font-tdpfr',
    extensions: ['pfr'],
  },
  {
    key: 'application/geo+json',
    extensions: ['geojson'],
  },
  {
    key: 'application/gml+xml',
    extensions: ['gml'],
  },
  {
    key: 'application/gpx+xml',
    extensions: ['gpx'],
  },
  {
    key: 'application/gxf',
    extensions: ['gxf'],
  },
  {
    key: 'application/gzip',
    extensions: ['gz'],
  },
  {
    key: 'application/hjson',
    extensions: ['hjson'],
  },
  {
    key: 'application/hyperstudio',
    extensions: ['stk'],
  },
  {
    key: 'application/inkml+xml',
    extensions: ['ink', 'inkml'],
  },
  {
    key: 'application/ipfix',
    extensions: ['ipfix'],
  },
  {
    key: 'application/its+xml',
    extensions: ['its'],
  },
  {
    key: 'application/java-archive',
    extensions: ['jar', 'war', 'ear'],
  },
  {
    key: 'application/java-serialized-object',
    extensions: ['ser'],
  },
  {
    key: 'application/java-vm',
    extensions: ['class'],
  },
  {
    key: 'application/javascript',
    extensions: ['js'],
  },
  {
    key: 'application/json',
    extensions: ['json', 'map'],
  },
  {
    key: 'application/json5',
    extensions: ['json5'],
  },
  {
    key: 'application/jsonml+json',
    extensions: ['jsonml'],
  },
  {
    key: 'application/ld+json',
    extensions: ['jsonld'],
  },
  {
    key: 'application/lgr+xml',
    extensions: ['lgr'],
  },
  {
    key: 'application/lost+xml',
    extensions: ['lostxml'],
  },
  {
    key: 'application/mac-binhex40',
    extensions: ['hqx'],
  },
  {
    key: 'application/mac-compactpro',
    extensions: ['cpt'],
  },
  {
    key: 'application/mads+xml',
    extensions: ['mads'],
  },
  {
    key: 'application/manifest+json',
    extensions: ['webmanifest'],
  },
  {
    key: 'application/marc',
    extensions: ['mrc'],
  },
  {
    key: 'application/marcxml+xml',
    extensions: ['mrcx'],
  },
  {
    key: 'application/mathematica',
    extensions: ['ma', 'nb', 'mb'],
  },
  {
    key: 'application/mathml+xml',
    extensions: ['mathml'],
  },
  {
    key: 'application/mbox',
    extensions: ['mbox'],
  },
  {
    key: 'application/media-policy-dataset+xml',
    extensions: ['mpf'],
  },
  {
    key: 'application/mediaservercontrol+xml',
    extensions: ['mscml'],
  },
  {
    key: 'application/metalink+xml',
    extensions: ['metalink'],
  },
  {
    key: 'application/metalink4+xml',
    extensions: ['meta4'],
  },
  {
    key: 'application/mets+xml',
    extensions: ['mets'],
  },
  {
    key: 'application/mmt-aei+xml',
    extensions: ['maei'],
  },
  {
    key: 'application/mmt-usd+xml',
    extensions: ['musd'],
  },
  {
    key: 'application/mods+xml',
    extensions: ['mods'],
  },
  {
    key: 'application/mp21',
    extensions: ['m21', 'mp21'],
  },
  {
    key: 'application/mp4',
    extensions: ['mp4', 'mpg4', 'mp4s', 'm4p'],
  },
  {
    key: 'application/msix',
    extensions: ['msix'],
  },
  {
    key: 'application/msixbundle',
    extensions: ['msixbundle'],
  },
  {
    key: 'application/msword',
    extensions: ['doc', 'dot'],
  },
  {
    key: 'application/mxf',
    extensions: ['mxf'],
  },
  {
    key: 'application/n-quads',
    extensions: ['nq'],
  },
  {
    key: 'application/n-triples',
    extensions: ['nt'],
  },
  {
    key: 'application/node',
    extensions: ['cjs'],
  },
  {
    key: 'application/octet-stream',
    extensions: [
      'bin',
      'dms',
      'lrf',
      'mar',
      'so',
      'dist',
      'distz',
      'pkg',
      'bpk',
      'dump',
      'elc',
      'deploy',
      'exe',
      'dll',
      'deb',
      'dmg',
      'iso',
      'img',
      'msi',
      'msp',
      'msm',
      'buffer',
    ],
  },
  {
    key: 'application/oda',
    extensions: ['oda'],
  },
  {
    key: 'application/oebps-package+xml',
    extensions: ['opf'],
  },
  {
    key: 'application/ogg',
    extensions: ['ogx'],
  },
  {
    key: 'application/omdoc+xml',
    extensions: ['omdoc'],
  },
  {
    key: 'application/onenote',
    extensions: ['onetoc', 'onetoc2', 'onetmp', 'onepkg'],
  },
  {
    key: 'application/oxps',
    extensions: ['oxps'],
  },
  {
    key: 'application/p2p-overlay+xml',
    extensions: ['relo'],
  },
  {
    key: 'application/patch-ops-error+xml',
    extensions: ['xer'],
  },
  {
    key: 'application/pdf',
    extensions: ['pdf'],
  },
  {
    key: 'application/pgp-encrypted',
    extensions: ['pgp'],
  },
  {
    key: 'application/pgp-keys',
    extensions: ['asc'],
  },
  {
    key: 'application/pgp-signature',
    extensions: ['sig', 'asc'],
  },
  {
    key: 'application/pics-rules',
    extensions: ['prf'],
  },
  {
    key: 'application/pkcs10',
    extensions: ['p10'],
  },
  {
    key: 'application/pkcs7-mime',
    extensions: ['p7m', 'p7c'],
  },
  {
    key: 'application/pkcs7-signature',
    extensions: ['p7s'],
  },
  {
    key: 'application/pkcs8',
    extensions: ['p8'],
  },
  {
    key: 'application/pkix-attr-cert',
    extensions: ['ac'],
  },
  {
    key: 'application/pkix-cert',
    extensions: ['cer'],
  },
  {
    key: 'application/pkix-crl',
    extensions: ['crl'],
  },
  {
    key: 'application/pkix-pkipath',
    extensions: ['pkipath'],
  },
  {
    key: 'application/pkixcmp',
    extensions: ['pki'],
  },
  {
    key: 'application/pls+xml',
    extensions: ['pls'],
  },
  {
    key: 'application/postscript',
    extensions: ['ai', 'eps', 'ps'],
  },
  {
    key: 'application/provenance+xml',
    extensions: ['provx'],
  },
  {
    key: 'application/prs.cww',
    extensions: ['cww'],
  },
  {
    key: 'application/prs.xsf+xml',
    extensions: ['xsf'],
  },
  {
    key: 'application/pskc+xml',
    extensions: ['pskcxml'],
  },
  {
    key: 'application/raml+yaml',
    extensions: ['raml'],
  },
  {
    key: 'application/rdf+xml',
    extensions: ['rdf', 'owl'],
  },
  {
    key: 'application/reginfo+xml',
    extensions: ['rif'],
  },
  {
    key: 'application/relax-ng-compact-syntax',
    extensions: ['rnc'],
  },
  {
    key: 'application/resource-lists+xml',
    extensions: ['rl'],
  },
  {
    key: 'application/resource-lists-diff+xml',
    extensions: ['rld'],
  },
  {
    key: 'application/rls-services+xml',
    extensions: ['rs'],
  },
  {
    key: 'application/route-apd+xml',
    extensions: ['rapd'],
  },
  {
    key: 'application/route-s-tsid+xml',
    extensions: ['sls'],
  },
  {
    key: 'application/route-usd+xml',
    extensions: ['rusd'],
  },
  {
    key: 'application/rpki-ghostbusters',
    extensions: ['gbr'],
  },
  {
    key: 'application/rpki-manifest',
    extensions: ['mft'],
  },
  {
    key: 'application/rpki-roa',
    extensions: ['roa'],
  },
  {
    key: 'application/rsd+xml',
    extensions: ['rsd'],
  },
  {
    key: 'application/rss+xml',
    extensions: ['rss'],
  },
  {
    key: 'application/rtf',
    extensions: ['rtf'],
  },
  {
    key: 'application/sbml+xml',
    extensions: ['sbml'],
  },
  {
    key: 'application/scvp-cv-request',
    extensions: ['scq'],
  },
  {
    key: 'application/scvp-cv-response',
    extensions: ['scs'],
  },
  {
    key: 'application/scvp-vp-request',
    extensions: ['spq'],
  },
  {
    key: 'application/scvp-vp-response',
    extensions: ['spp'],
  },
  {
    key: 'application/sdp',
    extensions: ['sdp'],
  },
  {
    key: 'application/senml+xml',
    extensions: ['senmlx'],
  },
  {
    key: 'application/sensml+xml',
    extensions: ['sensmlx'],
  },
  {
    key: 'application/set-payment-initiation',
    extensions: ['setpay'],
  },
  {
    key: 'application/set-registration-initiation',
    extensions: ['setreg'],
  },
  {
    key: 'application/shf+xml',
    extensions: ['shf'],
  },
  {
    key: 'application/sieve',
    extensions: ['siv', 'sieve'],
  },
  {
    key: 'application/smil+xml',
    extensions: ['smi', 'smil'],
  },
  {
    key: 'application/sparql-query',
    extensions: ['rq'],
  },
  {
    key: 'application/sparql-results+xml',
    extensions: ['srx'],
  },
  {
    key: 'application/sql',
    extensions: ['sql'],
  },
  {
    key: 'application/srgs',
    extensions: ['gram'],
  },
  {
    key: 'application/srgs+xml',
    extensions: ['grxml'],
  },
  {
    key: 'application/sru+xml',
    extensions: ['sru'],
  },
  {
    key: 'application/ssdl+xml',
    extensions: ['ssdl'],
  },
  {
    key: 'application/ssml+xml',
    extensions: ['ssml'],
  },
  {
    key: 'application/swid+xml',
    extensions: ['swidtag'],
  },
  {
    key: 'application/tei+xml',
    extensions: ['tei', 'teicorpus'],
  },
  {
    key: 'application/thraud+xml',
    extensions: ['tfi'],
  },
  {
    key: 'application/timestamped-data',
    extensions: ['tsd'],
  },
  {
    key: 'application/toml',
    extensions: ['toml'],
  },
  {
    key: 'application/trig',
    extensions: ['trig'],
  },
  {
    key: 'application/ttml+xml',
    extensions: ['ttml'],
  },
  {
    key: 'application/ubjson',
    extensions: ['ubj'],
  },
  {
    key: 'application/urc-ressheet+xml',
    extensions: ['rsheet'],
  },
  {
    key: 'application/urc-targetdesc+xml',
    extensions: ['td'],
  },
  {
    key: 'application/vnd.1000minds.decision-model+xml',
    extensions: ['1km'],
  },
  {
    key: 'application/vnd.3gpp.pic-bw-large',
    extensions: ['plb'],
  },
  {
    key: 'application/vnd.3gpp.pic-bw-small',
    extensions: ['psb'],
  },
  {
    key: 'application/vnd.3gpp.pic-bw-var',
    extensions: ['pvb'],
  },
  {
    key: 'application/vnd.3gpp2.tcap',
    extensions: ['tcap'],
  },
  {
    key: 'application/vnd.3m.post-it-notes',
    extensions: ['pwn'],
  },
  {
    key: 'application/vnd.accpac.simply.aso',
    extensions: ['aso'],
  },
  {
    key: 'application/vnd.accpac.simply.imp',
    extensions: ['imp'],
  },
  {
    key: 'application/vnd.acucobol',
    extensions: ['acu'],
  },
  {
    key: 'application/vnd.acucorp',
    extensions: ['atc', 'acutc'],
  },
  {
    key: 'application/vnd.adobe.air-application-installer-package+zip',
    extensions: ['air'],
  },
  {
    key: 'application/vnd.adobe.formscentral.fcdt',
    extensions: ['fcdt'],
  },
  {
    key: 'application/vnd.adobe.fxp',
    extensions: ['fxp', 'fxpl'],
  },
  {
    key: 'application/vnd.adobe.xdp+xml',
    extensions: ['xdp'],
  },
  {
    key: 'application/vnd.adobe.xfdf',
    extensions: ['xfdf'],
  },
  {
    key: 'application/vnd.age',
    extensions: ['age'],
  },
  {
    key: 'application/vnd.ahead.space',
    extensions: ['ahead'],
  },
  {
    key: 'application/vnd.airzip.filesecure.azf',
    extensions: ['azf'],
  },
  {
    key: 'application/vnd.airzip.filesecure.azs',
    extensions: ['azs'],
  },
  {
    key: 'application/vnd.amazon.ebook',
    extensions: ['azw'],
  },
  {
    key: 'application/vnd.americandynamics.acc',
    extensions: ['acc'],
  },
  {
    key: 'application/vnd.amiga.ami',
    extensions: ['ami'],
  },
  {
    key: 'application/vnd.android.package-archive',
    extensions: ['apk'],
  },
  {
    key: 'application/vnd.anser-web-certificate-issue-initiation',
    extensions: ['cii'],
  },
  {
    key: 'application/vnd.anser-web-funds-transfer-initiation',
    extensions: ['fti'],
  },
  {
    key: 'application/vnd.antix.game-component',
    extensions: ['atx'],
  },
  {
    key: 'application/vnd.apple.installer+xml',
    extensions: ['mpkg'],
  },
  {
    key: 'application/vnd.apple.keynote',
    extensions: ['key'],
  },
  {
    key: 'application/vnd.apple.mpegurl',
    extensions: ['m3u8'],
  },
  {
    key: 'application/vnd.apple.numbers',
    extensions: ['numbers'],
  },
  {
    key: 'application/vnd.apple.pages',
    extensions: ['pages'],
  },
  {
    key: 'application/vnd.apple.pkpass',
    extensions: ['pkpass'],
  },
  {
    key: 'application/vnd.aristanetworks.swi',
    extensions: ['swi'],
  },
  {
    key: 'application/vnd.astraea-software.iota',
    extensions: ['iota'],
  },
  {
    key: 'application/vnd.audiograph',
    extensions: ['aep'],
  },
  {
    key: 'application/vnd.balsamiq.bmml+xml',
    extensions: ['bmml'],
  },
  {
    key: 'application/vnd.blueice.multipass',
    extensions: ['mpm'],
  },
  {
    key: 'application/vnd.bmi',
    extensions: ['bmi'],
  },
  {
    key: 'application/vnd.businessobjects',
    extensions: ['rep'],
  },
  {
    key: 'application/vnd.chemdraw+xml',
    extensions: ['cdxml'],
  },
  {
    key: 'application/vnd.chipnuts.karaoke-mmd',
    extensions: ['mmd'],
  },
  {
    key: 'application/vnd.cinderella',
    extensions: ['cdy'],
  },
  {
    key: 'application/vnd.citationstyles.style+xml',
    extensions: ['csl'],
  },
  {
    key: 'application/vnd.claymore',
    extensions: ['cla'],
  },
  {
    key: 'application/vnd.cloanto.rp9',
    extensions: ['rp9'],
  },
  {
    key: 'application/vnd.clonk.c4group',
    extensions: ['c4g', 'c4d', 'c4f', 'c4p', 'c4u'],
  },
  {
    key: 'application/vnd.cluetrust.cartomobile-config',
    extensions: ['c11amc'],
  },
  {
    key: 'application/vnd.cluetrust.cartomobile-config-pkg',
    extensions: ['c11amz'],
  },
  {
    key: 'application/vnd.commonspace',
    extensions: ['csp'],
  },
  {
    key: 'application/vnd.contact.cmsg',
    extensions: ['cdbcmsg'],
  },
  {
    key: 'application/vnd.cosmocaller',
    extensions: ['cmc'],
  },
  {
    key: 'application/vnd.crick.clicker',
    extensions: ['clkx'],
  },
  {
    key: 'application/vnd.crick.clicker.keyboard',
    extensions: ['clkk'],
  },
  {
    key: 'application/vnd.crick.clicker.palette',
    extensions: ['clkp'],
  },
  {
    key: 'application/vnd.crick.clicker.template',
    extensions: ['clkt'],
  },
  {
    key: 'application/vnd.crick.clicker.wordbank',
    extensions: ['clkw'],
  },
  {
    key: 'application/vnd.criticaltools.wbs+xml',
    extensions: ['wbs'],
  },
  {
    key: 'application/vnd.ctc-posml',
    extensions: ['pml'],
  },
  {
    key: 'application/vnd.cups-ppd',
    extensions: ['ppd'],
  },
  {
    key: 'application/vnd.curl.car',
    extensions: ['car'],
  },
  {
    key: 'application/vnd.curl.pcurl',
    extensions: ['pcurl'],
  },
  {
    key: 'application/vnd.dart',
    extensions: ['dart'],
  },
  {
    key: 'application/vnd.data-vision.rdz',
    extensions: ['rdz'],
  },
  {
    key: 'application/vnd.dbf',
    extensions: ['dbf'],
  },
  {
    key: 'application/vnd.dece.data',
    extensions: ['uvf', 'uvvf', 'uvd', 'uvvd'],
  },
  {
    key: 'application/vnd.dece.ttml+xml',
    extensions: ['uvt', 'uvvt'],
  },
  {
    key: 'application/vnd.dece.unspecified',
    extensions: ['uvx', 'uvvx'],
  },
  {
    key: 'application/vnd.dece.zip',
    extensions: ['uvz', 'uvvz'],
  },
  {
    key: 'application/vnd.denovo.fcselayout-link',
    extensions: ['fe_launch'],
  },
  {
    key: 'application/vnd.dna',
    extensions: ['dna'],
  },
  {
    key: 'application/vnd.dolby.mlp',
    extensions: ['mlp'],
  },
  {
    key: 'application/vnd.dpgraph',
    extensions: ['dpg'],
  },
  {
    key: 'application/vnd.dreamfactory',
    extensions: ['dfac'],
  },
  {
    key: 'application/vnd.ds-keypoint',
    extensions: ['kpxx'],
  },
  {
    key: 'application/vnd.dvb.ait',
    extensions: ['ait'],
  },
  {
    key: 'application/vnd.dvb.service',
    extensions: ['svc'],
  },
  {
    key: 'application/vnd.dynageo',
    extensions: ['geo'],
  },
  {
    key: 'application/vnd.ecowin.chart',
    extensions: ['mag'],
  },
  {
    key: 'application/vnd.enliven',
    extensions: ['nml'],
  },
  {
    key: 'application/vnd.epson.esf',
    extensions: ['esf'],
  },
  {
    key: 'application/vnd.epson.msf',
    extensions: ['msf'],
  },
  {
    key: 'application/vnd.epson.quickanime',
    extensions: ['qam'],
  },
  {
    key: 'application/vnd.epson.salt',
    extensions: ['slt'],
  },
  {
    key: 'application/vnd.epson.ssf',
    extensions: ['ssf'],
  },
  {
    key: 'application/vnd.eszigno3+xml',
    extensions: ['es3', 'et3'],
  },
  {
    key: 'application/vnd.ezpix-album',
    extensions: ['ez2'],
  },
  {
    key: 'application/vnd.ezpix-package',
    extensions: ['ez3'],
  },
  {
    key: 'application/vnd.fdf',
    extensions: ['fdf'],
  },
  {
    key: 'application/vnd.fdsn.mseed',
    extensions: ['mseed'],
  },
  {
    key: 'application/vnd.fdsn.seed',
    extensions: ['seed', 'dataless'],
  },
  {
    key: 'application/vnd.flographit',
    extensions: ['gph'],
  },
  {
    key: 'application/vnd.fluxtime.clip',
    extensions: ['ftc'],
  },
  {
    key: 'application/vnd.framemaker',
    extensions: ['fm', 'frame', 'maker', 'book'],
  },
  {
    key: 'application/vnd.frogans.fnc',
    extensions: ['fnc'],
  },
  {
    key: 'application/vnd.frogans.ltf',
    extensions: ['ltf'],
  },
  {
    key: 'application/vnd.fsc.weblaunch',
    extensions: ['fsc'],
  },
  {
    key: 'application/vnd.fujitsu.oasys',
    extensions: ['oas'],
  },
  {
    key: 'application/vnd.fujitsu.oasys2',
    extensions: ['oa2'],
  },
  {
    key: 'application/vnd.fujitsu.oasys3',
    extensions: ['oa3'],
  },
  {
    key: 'application/vnd.fujitsu.oasysgp',
    extensions: ['fg5'],
  },
  {
    key: 'application/vnd.fujitsu.oasysprs',
    extensions: ['bh2'],
  },
  {
    key: 'application/vnd.fujixerox.ddd',
    extensions: ['ddd'],
  },
  {
    key: 'application/vnd.fujixerox.docuworks',
    extensions: ['xdw'],
  },
  {
    key: 'application/vnd.fujixerox.docuworks.binder',
    extensions: ['xbd'],
  },
  {
    key: 'application/vnd.fuzzysheet',
    extensions: ['fzs'],
  },
  {
    key: 'application/vnd.genomatix.tuxedo',
    extensions: ['txd'],
  },
  {
    key: 'application/vnd.geogebra.file',
    extensions: ['ggb'],
  },
  {
    key: 'application/vnd.geogebra.slides',
    extensions: ['ggs'],
  },
  {
    key: 'application/vnd.geogebra.tool',
    extensions: ['ggt'],
  },
  {
    key: 'application/vnd.geometry-explorer',
    extensions: ['gex', 'gre'],
  },
  {
    key: 'application/vnd.geonext',
    extensions: ['gxt'],
  },
  {
    key: 'application/vnd.geoplan',
    extensions: ['g2w'],
  },
  {
    key: 'application/vnd.geospace',
    extensions: ['g3w'],
  },
  {
    key: 'application/vnd.gmx',
    extensions: ['gmx'],
  },
  {
    key: 'application/vnd.google-apps.document',
    extensions: ['gdoc'],
  },
  {
    key: 'application/vnd.google-apps.presentation',
    extensions: ['gslides'],
  },
  {
    key: 'application/vnd.google-apps.spreadsheet',
    extensions: ['gsheet'],
  },
  {
    key: 'application/vnd.google-earth.kml+xml',
    extensions: ['kml'],
  },
  {
    key: 'application/vnd.google-earth.kmz',
    extensions: ['kmz'],
  },
  {
    key: 'application/vnd.gov.sk.xmldatacontainer+xml',
    extensions: ['xdcf'],
  },
  {
    key: 'application/vnd.grafeq',
    extensions: ['gqf', 'gqs'],
  },
  {
    key: 'application/vnd.groove-account',
    extensions: ['gac'],
  },
  {
    key: 'application/vnd.groove-help',
    extensions: ['ghf'],
  },
  {
    key: 'application/vnd.groove-identity-message',
    extensions: ['gim'],
  },
  {
    key: 'application/vnd.groove-injector',
    extensions: ['grv'],
  },
  {
    key: 'application/vnd.groove-tool-message',
    extensions: ['gtm'],
  },
  {
    key: 'application/vnd.groove-tool-template',
    extensions: ['tpl'],
  },
  {
    key: 'application/vnd.groove-vcard',
    extensions: ['vcg'],
  },
  {
    key: 'application/vnd.hal+xml',
    extensions: ['hal'],
  },
  {
    key: 'application/vnd.handheld-entertainment+xml',
    extensions: ['zmm'],
  },
  {
    key: 'application/vnd.hbci',
    extensions: ['hbci'],
  },
  {
    key: 'application/vnd.hhe.lesson-player',
    extensions: ['les'],
  },
  {
    key: 'application/vnd.hp-hpgl',
    extensions: ['hpgl'],
  },
  {
    key: 'application/vnd.hp-hpid',
    extensions: ['hpid'],
  },
  {
    key: 'application/vnd.hp-hps',
    extensions: ['hps'],
  },
  {
    key: 'application/vnd.hp-jlyt',
    extensions: ['jlt'],
  },
  {
    key: 'application/vnd.hp-pcl',
    extensions: ['pcl'],
  },
  {
    key: 'application/vnd.hp-pclxl',
    extensions: ['pclxl'],
  },
  {
    key: 'application/vnd.hydrostatix.sof-data',
    extensions: ['sfd-hdstx'],
  },
  {
    key: 'application/vnd.ibm.minipay',
    extensions: ['mpy'],
  },
  {
    key: 'application/vnd.ibm.modcap',
    extensions: ['afp', 'listafp', 'list3820'],
  },
  {
    key: 'application/vnd.ibm.rights-management',
    extensions: ['irm'],
  },
  {
    key: 'application/vnd.ibm.secure-container',
    extensions: ['sc'],
  },
  {
    key: 'application/vnd.iccprofile',
    extensions: ['icc', 'icm'],
  },
  {
    key: 'application/vnd.igloader',
    extensions: ['igl'],
  },
  {
    key: 'application/vnd.immervision-ivp',
    extensions: ['ivp'],
  },
  {
    key: 'application/vnd.immervision-ivu',
    extensions: ['ivu'],
  },
  {
    key: 'application/vnd.insors.igm',
    extensions: ['igm'],
  },
  {
    key: 'application/vnd.intercon.formnet',
    extensions: ['xpw', 'xpx'],
  },
  {
    key: 'application/vnd.intergeo',
    extensions: ['i2g'],
  },
  {
    key: 'application/vnd.intu.qbo',
    extensions: ['qbo'],
  },
  {
    key: 'application/vnd.intu.qfx',
    extensions: ['qfx'],
  },
  {
    key: 'application/vnd.ipunplugged.rcprofile',
    extensions: ['rcprofile'],
  },
  {
    key: 'application/vnd.irepository.package+xml',
    extensions: ['irp'],
  },
  {
    key: 'application/vnd.is-xpr',
    extensions: ['xpr'],
  },
  {
    key: 'application/vnd.isac.fcs',
    extensions: ['fcs'],
  },
  {
    key: 'application/vnd.jam',
    extensions: ['jam'],
  },
  {
    key: 'application/vnd.jcp.javame.midlet-rms',
    extensions: ['rms'],
  },
  {
    key: 'application/vnd.jisp',
    extensions: ['jisp'],
  },
  {
    key: 'application/vnd.joost.joda-archive',
    extensions: ['joda'],
  },
  {
    key: 'application/vnd.kahootz',
    extensions: ['ktz', 'ktr'],
  },
  {
    key: 'application/vnd.kde.karbon',
    extensions: ['karbon'],
  },
  {
    key: 'application/vnd.kde.kchart',
    extensions: ['chrt'],
  },
  {
    key: 'application/vnd.kde.kformula',
    extensions: ['kfo'],
  },
  {
    key: 'application/vnd.kde.kivio',
    extensions: ['flw'],
  },
  {
    key: 'application/vnd.kde.kontour',
    extensions: ['kon'],
  },
  {
    key: 'application/vnd.kde.kpresenter',
    extensions: ['kpr', 'kpt'],
  },
  {
    key: 'application/vnd.kde.kspread',
    extensions: ['ksp'],
  },
  {
    key: 'application/vnd.kde.kword',
    extensions: ['kwd', 'kwt'],
  },
  {
    key: 'application/vnd.kenameaapp',
    extensions: ['htke'],
  },
  {
    key: 'application/vnd.kidspiration',
    extensions: ['kia'],
  },
  {
    key: 'application/vnd.kinar',
    extensions: ['kne', 'knp'],
  },
  {
    key: 'application/vnd.koan',
    extensions: ['skp', 'skd', 'skt', 'skm'],
  },
  {
    key: 'application/vnd.kodak-descriptor',
    extensions: ['sse'],
  },
  {
    key: 'application/vnd.las.las+xml',
    extensions: ['lasxml'],
  },
  {
    key: 'application/vnd.llamagraphics.life-balance.desktop',
    extensions: ['lbd'],
  },
  {
    key: 'application/vnd.llamagraphics.life-balance.exchange+xml',
    extensions: ['lbe'],
  },
  {
    key: 'application/vnd.lotus-1-2-3',
    extensions: ['123'],
  },
  {
    key: 'application/vnd.lotus-approach',
    extensions: ['apr'],
  },
  {
    key: 'application/vnd.lotus-freelance',
    extensions: ['pre'],
  },
  {
    key: 'application/vnd.lotus-notes',
    extensions: ['nsf'],
  },
  {
    key: 'application/vnd.lotus-organizer',
    extensions: ['org'],
  },
  {
    key: 'application/vnd.lotus-screencam',
    extensions: ['scm'],
  },
  {
    key: 'application/vnd.lotus-wordpro',
    extensions: ['lwp'],
  },
  {
    key: 'application/vnd.macports.portpkg',
    extensions: ['portpkg'],
  },
  {
    key: 'application/vnd.mapbox-vector-tile',
    extensions: ['mvt'],
  },
  {
    key: 'application/vnd.mcd',
    extensions: ['mcd'],
  },
  {
    key: 'application/vnd.medcalcdata',
    extensions: ['mc1'],
  },
  {
    key: 'application/vnd.mediastation.cdkey',
    extensions: ['cdkey'],
  },
  {
    key: 'application/vnd.mfer',
    extensions: ['mwf'],
  },
  {
    key: 'application/vnd.mfmp',
    extensions: ['mfm'],
  },
  {
    key: 'application/vnd.micrografx.flo',
    extensions: ['flo'],
  },
  {
    key: 'application/vnd.micrografx.igx',
    extensions: ['igx'],
  },
  {
    key: 'application/vnd.mif',
    extensions: ['mif'],
  },
  {
    key: 'application/vnd.mobius.daf',
    extensions: ['daf'],
  },
  {
    key: 'application/vnd.mobius.dis',
    extensions: ['dis'],
  },
  {
    key: 'application/vnd.mobius.mbk',
    extensions: ['mbk'],
  },
  {
    key: 'application/vnd.mobius.mqy',
    extensions: ['mqy'],
  },
  {
    key: 'application/vnd.mobius.msl',
    extensions: ['msl'],
  },
  {
    key: 'application/vnd.mobius.plc',
    extensions: ['plc'],
  },
  {
    key: 'application/vnd.mobius.txf',
    extensions: ['txf'],
  },
  {
    key: 'application/vnd.mophun.application',
    extensions: ['mpn'],
  },
  {
    key: 'application/vnd.mophun.certificate',
    extensions: ['mpc'],
  },
  {
    key: 'application/vnd.mozilla.xul+xml',
    extensions: ['xul'],
  },
  {
    key: 'application/vnd.ms-artgalry',
    extensions: ['cil'],
  },
  {
    key: 'application/vnd.ms-cab-compressed',
    extensions: ['cab'],
  },
  {
    key: 'application/vnd.ms-excel',
    extensions: ['xls', 'xlm', 'xla', 'xlc', 'xlt', 'xlw'],
  },
  {
    key: 'application/vnd.ms-excel.addin.macroenabled.12',
    extensions: ['xlam'],
  },
  {
    key: 'application/vnd.ms-excel.sheet.binary.macroenabled.12',
    extensions: ['xlsb'],
  },
  {
    key: 'application/vnd.ms-excel.sheet.macroenabled.12',
    extensions: ['xlsm'],
  },
  {
    key: 'application/vnd.ms-excel.template.macroenabled.12',
    extensions: ['xltm'],
  },
  {
    key: 'application/vnd.ms-fontobject',
    extensions: ['eot'],
  },
  {
    key: 'application/vnd.ms-htmlhelp',
    extensions: ['chm'],
  },
  {
    key: 'application/vnd.ms-ims',
    extensions: ['ims'],
  },
  {
    key: 'application/vnd.ms-lrm',
    extensions: ['lrm'],
  },
  {
    key: 'application/vnd.ms-officetheme',
    extensions: ['thmx'],
  },
  {
    key: 'application/vnd.ms-outlook',
    extensions: ['msg'],
  },
  {
    key: 'application/vnd.ms-pki.seccat',
    extensions: ['cat'],
  },
  {
    key: 'application/vnd.ms-pki.stl',
    extensions: ['stl'],
  },
  {
    key: 'application/vnd.ms-powerpoint',
    extensions: ['ppt', 'pps', 'pot'],
  },
  {
    key: 'application/vnd.ms-powerpoint.addin.macroenabled.12',
    extensions: ['ppam'],
  },
  {
    key: 'application/vnd.ms-powerpoint.presentation.macroenabled.12',
    extensions: ['pptm'],
  },
  {
    key: 'application/vnd.ms-powerpoint.slide.macroenabled.12',
    extensions: ['sldm'],
  },
  {
    key: 'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
    extensions: ['ppsm'],
  },
  {
    key: 'application/vnd.ms-powerpoint.template.macroenabled.12',
    extensions: ['potm'],
  },
  {
    key: 'application/vnd.ms-project',
    extensions: ['mpp', 'mpt'],
  },
  {
    key: 'application/vnd.ms-word.document.macroenabled.12',
    extensions: ['docm'],
  },
  {
    key: 'application/vnd.ms-word.template.macroenabled.12',
    extensions: ['dotm'],
  },
  {
    key: 'application/vnd.ms-works',
    extensions: ['wps', 'wks', 'wcm', 'wdb'],
  },
  {
    key: 'application/vnd.ms-wpl',
    extensions: ['wpl'],
  },
  {
    key: 'application/vnd.ms-xpsdocument',
    extensions: ['xps'],
  },
  {
    key: 'application/vnd.mseq',
    extensions: ['mseq'],
  },
  {
    key: 'application/vnd.musician',
    extensions: ['mus'],
  },
  {
    key: 'application/vnd.muvee.style',
    extensions: ['msty'],
  },
  {
    key: 'application/vnd.mynfc',
    extensions: ['taglet'],
  },
  {
    key: 'application/vnd.nato.bindingdataobject+xml',
    extensions: ['bdo'],
  },
  {
    key: 'application/vnd.neurolanguage.nlu',
    extensions: ['nlu'],
  },
  {
    key: 'application/vnd.nitf',
    extensions: ['ntf', 'nitf'],
  },
  {
    key: 'application/vnd.noblenet-directory',
    extensions: ['nnd'],
  },
  {
    key: 'application/vnd.noblenet-sealer',
    extensions: ['nns'],
  },
  {
    key: 'application/vnd.noblenet-web',
    extensions: ['nnw'],
  },
  {
    key: 'application/vnd.nokia.n-gage.ac+xml',
    extensions: ['ac'],
  },
  {
    key: 'application/vnd.nokia.n-gage.data',
    extensions: ['ngdat'],
  },
  {
    key: 'application/vnd.nokia.n-gage.symbian.install',
    extensions: ['n-gage'],
  },
  {
    key: 'application/vnd.nokia.radio-preset',
    extensions: ['rpst'],
  },
  {
    key: 'application/vnd.nokia.radio-presets',
    extensions: ['rpss'],
  },
  {
    key: 'application/vnd.novadigm.edm',
    extensions: ['edm'],
  },
  {
    key: 'application/vnd.novadigm.edx',
    extensions: ['edx'],
  },
  {
    key: 'application/vnd.novadigm.ext',
    extensions: ['ext'],
  },
  {
    key: 'application/vnd.oasis.opendocument.chart',
    extensions: ['odc'],
  },
  {
    key: 'application/vnd.oasis.opendocument.chart-template',
    extensions: ['otc'],
  },
  {
    key: 'application/vnd.oasis.opendocument.database',
    extensions: ['odb'],
  },
  {
    key: 'application/vnd.oasis.opendocument.formula',
    extensions: ['odf'],
  },
  {
    key: 'application/vnd.oasis.opendocument.formula-template',
    extensions: ['odft'],
  },
  {
    key: 'application/vnd.oasis.opendocument.graphics',
    extensions: ['odg'],
  },
  {
    key: 'application/vnd.oasis.opendocument.graphics-template',
    extensions: ['otg'],
  },
  {
    key: 'application/vnd.oasis.opendocument.image',
    extensions: ['odi'],
  },
  {
    key: 'application/vnd.oasis.opendocument.image-template',
    extensions: ['oti'],
  },
  {
    key: 'application/vnd.oasis.opendocument.presentation',
    extensions: ['odp'],
  },
  {
    key: 'application/vnd.oasis.opendocument.presentation-template',
    extensions: ['otp'],
  },
  {
    key: 'application/vnd.oasis.opendocument.spreadsheet',
    extensions: ['ods'],
  },
  {
    key: 'application/vnd.oasis.opendocument.spreadsheet-template',
    extensions: ['ots'],
  },
  {
    key: 'application/vnd.oasis.opendocument.text',
    extensions: ['odt'],
  },
  {
    key: 'application/vnd.oasis.opendocument.text-master',
    extensions: ['odm'],
  },
  {
    key: 'application/vnd.oasis.opendocument.text-template',
    extensions: ['ott'],
  },
  {
    key: 'application/vnd.oasis.opendocument.text-web',
    extensions: ['oth'],
  },
  {
    key: 'application/vnd.olpc-sugar',
    extensions: ['xo'],
  },
  {
    key: 'application/vnd.oma.dd2+xml',
    extensions: ['dd2'],
  },
  {
    key: 'application/vnd.openblox.game+xml',
    extensions: ['obgx'],
  },
  {
    key: 'application/vnd.openofficeorg.extension',
    extensions: ['oxt'],
  },
  {
    key: 'application/vnd.openstreetmap.data+xml',
    extensions: ['osm'],
  },
  {
    key: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extensions: ['pptx'],
  },
  {
    key: 'application/vnd.openxmlformats-officedocument.presentationml.slide',
    extensions: ['sldx'],
  },
  {
    key: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
    extensions: ['ppsx'],
  },
  {
    key: 'application/vnd.openxmlformats-officedocument.presentationml.template',
    extensions: ['potx'],
  },
  {
    key: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['xlsx'],
  },
  {
    key: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
    extensions: ['xltx'],
  },
  {
    key: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'],
  },
  {
    key: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
    extensions: ['dotx'],
  },
  {
    key: 'application/vnd.osgeo.mapguide.package',
    extensions: ['mgp'],
  },
  {
    key: 'application/vnd.osgi.dp',
    extensions: ['dp'],
  },
  {
    key: 'application/vnd.osgi.subsystem',
    extensions: ['esa'],
  },
  {
    key: 'application/vnd.palm',
    extensions: ['pdb', 'pqa', 'oprc'],
  },
  {
    key: 'application/vnd.pawaafile',
    extensions: ['paw'],
  },
  {
    key: 'application/vnd.pg.format',
    extensions: ['str'],
  },
  {
    key: 'application/vnd.pg.osasli',
    extensions: ['ei6'],
  },
  {
    key: 'application/vnd.picsel',
    extensions: ['efif'],
  },
  {
    key: 'application/vnd.pmi.widget',
    extensions: ['wg'],
  },
  {
    key: 'application/vnd.pocketlearn',
    extensions: ['plf'],
  },
  {
    key: 'application/vnd.powerbuilder6',
    extensions: ['pbd'],
  },
  {
    key: 'application/vnd.previewsystems.box',
    extensions: ['box'],
  },
  {
    key: 'application/vnd.proteus.magazine',
    extensions: ['mgz'],
  },
  {
    key: 'application/vnd.publishare-delta-tree',
    extensions: ['qps'],
  },
  {
    key: 'application/vnd.pvi.ptid1',
    extensions: ['ptid'],
  },
  {
    key: 'application/vnd.pwg-xhtml-print+xml',
    extensions: ['xhtm'],
  },
  {
    key: 'application/vnd.quark.quarkxpress',
    extensions: ['qxd', 'qxt', 'qwd', 'qwt', 'qxl', 'qxb'],
  },
  {
    key: 'application/vnd.rar',
    extensions: ['rar'],
  },
  {
    key: 'application/vnd.realvnc.bed',
    extensions: ['bed'],
  },
  {
    key: 'application/vnd.recordare.musicxml',
    extensions: ['mxl'],
  },
  {
    key: 'application/vnd.recordare.musicxml+xml',
    extensions: ['musicxml'],
  },
  {
    key: 'application/vnd.rig.cryptonote',
    extensions: ['cryptonote'],
  },
  {
    key: 'application/vnd.rim.cod',
    extensions: ['cod'],
  },
  {
    key: 'application/vnd.rn-realmedia',
    extensions: ['rm'],
  },
  {
    key: 'application/vnd.rn-realmedia-vbr',
    extensions: ['rmvb'],
  },
  {
    key: 'application/vnd.route66.link66+xml',
    extensions: ['link66'],
  },
  {
    key: 'application/vnd.sailingtracker.track',
    extensions: ['st'],
  },
  {
    key: 'application/vnd.seemail',
    extensions: ['see'],
  },
  {
    key: 'application/vnd.sema',
    extensions: ['sema'],
  },
  {
    key: 'application/vnd.semd',
    extensions: ['semd'],
  },
  {
    key: 'application/vnd.semf',
    extensions: ['semf'],
  },
  {
    key: 'application/vnd.shana.informed.formdata',
    extensions: ['ifm'],
  },
  {
    key: 'application/vnd.shana.informed.formtemplate',
    extensions: ['itp'],
  },
  {
    key: 'application/vnd.shana.informed.interchange',
    extensions: ['iif'],
  },
  {
    key: 'application/vnd.shana.informed.package',
    extensions: ['ipk'],
  },
  {
    key: 'application/vnd.simtech-mindmapper',
    extensions: ['twd', 'twds'],
  },
  {
    key: 'application/vnd.smaf',
    extensions: ['mmf'],
  },
  {
    key: 'application/vnd.smart.teacher',
    extensions: ['teacher'],
  },
  {
    key: 'application/vnd.software602.filler.form+xml',
    extensions: ['fo'],
  },
  {
    key: 'application/vnd.solent.sdkm+xml',
    extensions: ['sdkm', 'sdkd'],
  },
  {
    key: 'application/vnd.spotfire.dxp',
    extensions: ['dxp'],
  },
  {
    key: 'application/vnd.spotfire.sfs',
    extensions: ['sfs'],
  },
  {
    key: 'application/vnd.stardivision.calc',
    extensions: ['sdc'],
  },
  {
    key: 'application/vnd.stardivision.draw',
    extensions: ['sda'],
  },
  {
    key: 'application/vnd.stardivision.impress',
    extensions: ['sdd'],
  },
  {
    key: 'application/vnd.stardivision.math',
    extensions: ['smf'],
  },
  {
    key: 'application/vnd.stardivision.writer',
    extensions: ['sdw', 'vor'],
  },
  {
    key: 'application/vnd.stardivision.writer-global',
    extensions: ['sgl'],
  },
  {
    key: 'application/vnd.stepmania.package',
    extensions: ['smzip'],
  },
  {
    key: 'application/vnd.stepmania.stepchart',
    extensions: ['sm'],
  },
  {
    key: 'application/vnd.sun.wadl+xml',
    extensions: ['wadl'],
  },
  {
    key: 'application/vnd.sun.xml.calc',
    extensions: ['sxc'],
  },
  {
    key: 'application/vnd.sun.xml.calc.template',
    extensions: ['stc'],
  },
  {
    key: 'application/vnd.sun.xml.draw',
    extensions: ['sxd'],
  },
  {
    key: 'application/vnd.sun.xml.draw.template',
    extensions: ['std'],
  },
  {
    key: 'application/vnd.sun.xml.impress',
    extensions: ['sxi'],
  },
  {
    key: 'application/vnd.sun.xml.impress.template',
    extensions: ['sti'],
  },
  {
    key: 'application/vnd.sun.xml.math',
    extensions: ['sxm'],
  },
  {
    key: 'application/vnd.sun.xml.writer',
    extensions: ['sxw'],
  },
  {
    key: 'application/vnd.sun.xml.writer.global',
    extensions: ['sxg'],
  },
  {
    key: 'application/vnd.sun.xml.writer.template',
    extensions: ['stw'],
  },
  {
    key: 'application/vnd.sus-calendar',
    extensions: ['sus', 'susp'],
  },
  {
    key: 'application/vnd.svd',
    extensions: ['svd'],
  },
  {
    key: 'application/vnd.symbian.install',
    extensions: ['sis', 'sisx'],
  },
  {
    key: 'application/vnd.syncml+xml',
    extensions: ['xsm'],
  },
  {
    key: 'application/vnd.syncml.dm+wbxml',
    extensions: ['bdm'],
  },
  {
    key: 'application/vnd.syncml.dm+xml',
    extensions: ['xdm'],
  },
  {
    key: 'application/vnd.syncml.dmddf+xml',
    extensions: ['ddf'],
  },
  {
    key: 'application/vnd.tao.intent-module-archive',
    extensions: ['tao'],
  },
  {
    key: 'application/vnd.tcpdump.pcap',
    extensions: ['pcap', 'cap', 'dmp'],
  },
  {
    key: 'application/vnd.tmobile-livetv',
    extensions: ['tmo'],
  },
  {
    key: 'application/vnd.trid.tpt',
    extensions: ['tpt'],
  },
  {
    key: 'application/vnd.triscape.mxs',
    extensions: ['mxs'],
  },
  {
    key: 'application/vnd.trueapp',
    extensions: ['tra'],
  },
  {
    key: 'application/vnd.ufdl',
    extensions: ['ufd', 'ufdl'],
  },
  {
    key: 'application/vnd.uiq.theme',
    extensions: ['utz'],
  },
  {
    key: 'application/vnd.umajin',
    extensions: ['umj'],
  },
  {
    key: 'application/vnd.unity',
    extensions: ['unityweb'],
  },
  {
    key: 'application/vnd.uoml+xml',
    extensions: ['uoml', 'uo'],
  },
  {
    key: 'application/vnd.vcx',
    extensions: ['vcx'],
  },
  {
    key: 'application/vnd.visio',
    extensions: ['vsd', 'vst', 'vss', 'vsw'],
  },
  {
    key: 'application/vnd.visionary',
    extensions: ['vis'],
  },
  {
    key: 'application/vnd.vsf',
    extensions: ['vsf'],
  },
  {
    key: 'application/vnd.wap.wbxml',
    extensions: ['wbxml'],
  },
  {
    key: 'application/vnd.wap.wmlc',
    extensions: ['wmlc'],
  },
  {
    key: 'application/vnd.wap.wmlscriptc',
    extensions: ['wmlsc'],
  },
  {
    key: 'application/vnd.webturbo',
    extensions: ['wtb'],
  },
  {
    key: 'application/vnd.wolfram.player',
    extensions: ['nbp'],
  },
  {
    key: 'application/vnd.wordperfect',
    extensions: ['wpd'],
  },
  {
    key: 'application/vnd.wqd',
    extensions: ['wqd'],
  },
  {
    key: 'application/vnd.wt.stf',
    extensions: ['stf'],
  },
  {
    key: 'application/vnd.xara',
    extensions: ['xar'],
  },
  {
    key: 'application/vnd.xfdl',
    extensions: ['xfdl'],
  },
  {
    key: 'application/vnd.yamaha.hv-dic',
    extensions: ['hvd'],
  },
  {
    key: 'application/vnd.yamaha.hv-script',
    extensions: ['hvs'],
  },
  {
    key: 'application/vnd.yamaha.hv-voice',
    extensions: ['hvp'],
  },
  {
    key: 'application/vnd.yamaha.openscoreformat',
    extensions: ['osf'],
  },
  {
    key: 'application/vnd.yamaha.openscoreformat.osfpvg+xml',
    extensions: ['osfpvg'],
  },
  {
    key: 'application/vnd.yamaha.smaf-audio',
    extensions: ['saf'],
  },
  {
    key: 'application/vnd.yamaha.smaf-phrase',
    extensions: ['spf'],
  },
  {
    key: 'application/vnd.yellowriver-custom-menu',
    extensions: ['cmp'],
  },
  {
    key: 'application/vnd.zul',
    extensions: ['zir', 'zirz'],
  },
  {
    key: 'application/vnd.zzazz.deck+xml',
    extensions: ['zaz'],
  },
  {
    key: 'application/voicexml+xml',
    extensions: ['vxml'],
  },
  {
    key: 'application/wasm',
    extensions: ['wasm'],
  },
  {
    key: 'application/watcherinfo+xml',
    extensions: ['wif'],
  },
  {
    key: 'application/widget',
    extensions: ['wgt'],
  },
  {
    key: 'application/winhlp',
    extensions: ['hlp'],
  },
  {
    key: 'application/wsdl+xml',
    extensions: ['wsdl'],
  },
  {
    key: 'application/wspolicy+xml',
    extensions: ['wspolicy'],
  },
  {
    key: 'application/x-7z-compressed',
    extensions: ['7z'],
  },
  {
    key: 'application/x-abiword',
    extensions: ['abw'],
  },
  {
    key: 'application/x-ace-compressed',
    extensions: ['ace'],
  },
  {
    key: 'application/x-apple-diskimage',
    extensions: ['dmg'],
  },
  {
    key: 'application/x-arj',
    extensions: ['arj'],
  },
  {
    key: 'application/x-authorware-bin',
    extensions: ['aab', 'x32', 'u32', 'vox'],
  },
  {
    key: 'application/x-authorware-map',
    extensions: ['aam'],
  },
  {
    key: 'application/x-authorware-seg',
    extensions: ['aas'],
  },
  {
    key: 'application/x-bcpio',
    extensions: ['bcpio'],
  },
  {
    key: 'application/x-bdoc',
    extensions: ['bdoc'],
  },
  {
    key: 'application/x-bittorrent',
    extensions: ['torrent'],
  },
  {
    key: 'application/x-blorb',
    extensions: ['blb', 'blorb'],
  },
  {
    key: 'application/x-bzip',
    extensions: ['bz'],
  },
  {
    key: 'application/x-bzip2',
    extensions: ['bz2', 'boz'],
  },
  {
    key: 'application/x-cbr',
    extensions: ['cbr', 'cba', 'cbt', 'cbz', 'cb7'],
  },
  {
    key: 'application/x-cdlink',
    extensions: ['vcd'],
  },
  {
    key: 'application/x-cfs-compressed',
    extensions: ['cfs'],
  },
  {
    key: 'application/x-chat',
    extensions: ['chat'],
  },
  {
    key: 'application/x-chess-pgn',
    extensions: ['pgn'],
  },
  {
    key: 'application/x-chrome-extension',
    extensions: ['crx'],
  },
  {
    key: 'application/x-cocoa',
    extensions: ['cco'],
  },
  {
    key: 'application/x-conference',
    extensions: ['nsc'],
  },
  {
    key: 'application/x-cpio',
    extensions: ['cpio'],
  },
  {
    key: 'application/x-csh',
    extensions: ['csh'],
  },
  {
    key: 'application/x-debian-package',
    extensions: ['deb', 'udeb'],
  },
  {
    key: 'application/x-dgc-compressed',
    extensions: ['dgc'],
  },
  {
    key: 'application/x-director',
    extensions: ['dir', 'dcr', 'dxr', 'cst', 'cct', 'cxt', 'w3d', 'fgd', 'swa'],
  },
  {
    key: 'application/x-doom',
    extensions: ['wad'],
  },
  {
    key: 'application/x-dtbncx+xml',
    extensions: ['ncx'],
  },
  {
    key: 'application/x-dtbook+xml',
    extensions: ['dtb'],
  },
  {
    key: 'application/x-dtbresource+xml',
    extensions: ['res'],
  },
  {
    key: 'application/x-dvi',
    extensions: ['dvi'],
  },
  {
    key: 'application/x-envoy',
    extensions: ['evy'],
  },
  {
    key: 'application/x-eva',
    extensions: ['eva'],
  },
  {
    key: 'application/x-font-bdf',
    extensions: ['bdf'],
  },
  {
    key: 'application/x-font-ghostscript',
    extensions: ['gsf'],
  },
  {
    key: 'application/x-font-linux-psf',
    extensions: ['psf'],
  },
  {
    key: 'application/x-font-pcf',
    extensions: ['pcf'],
  },
  {
    key: 'application/x-font-snf',
    extensions: ['snf'],
  },
  {
    key: 'application/x-font-type1',
    extensions: ['pfa', 'pfb', 'pfm', 'afm'],
  },
  {
    key: 'application/x-freearc',
    extensions: ['arc'],
  },
  {
    key: 'application/x-futuresplash',
    extensions: ['spl'],
  },
  {
    key: 'application/x-gca-compressed',
    extensions: ['gca'],
  },
  {
    key: 'application/x-glulx',
    extensions: ['ulx'],
  },
  {
    key: 'application/x-gnumeric',
    extensions: ['gnumeric'],
  },
  {
    key: 'application/x-gramps-xml',
    extensions: ['gramps'],
  },
  {
    key: 'application/x-gtar',
    extensions: ['gtar'],
  },
  {
    key: 'application/x-hdf',
    extensions: ['hdf'],
  },
  {
    key: 'application/x-httpd-php',
    extensions: ['php'],
  },
  {
    key: 'text/x-php',
    extensions: ['php'],
  },
  {
    key: 'application/x-php',
    extensions: ['php'],
  },
  {
    key: 'application/x-install-instructions',
    extensions: ['install'],
  },
  {
    key: 'application/x-iso9660-image',
    extensions: ['iso'],
  },
  {
    key: 'application/x-iwork-keynote-sffkey',
    extensions: ['key'],
  },
  {
    key: 'application/x-iwork-numbers-sffnumbers',
    extensions: ['numbers'],
  },
  {
    key: 'application/x-iwork-pages-sffpages',
    extensions: ['pages'],
  },
  {
    key: 'application/x-java-archive-diff',
    extensions: ['jardiff'],
  },
  {
    key: 'application/x-java-jnlp-file',
    extensions: ['jnlp'],
  },
  {
    key: 'application/x-keepass2',
    extensions: ['kdbx'],
  },
  {
    key: 'application/x-latex',
    extensions: ['latex'],
  },
  {
    key: 'application/x-lua-bytecode',
    extensions: ['luac'],
  },
  {
    key: 'application/x-lzh-compressed',
    extensions: ['lzh', 'lha'],
  },
  {
    key: 'application/x-makeself',
    extensions: ['run'],
  },
  {
    key: 'application/x-mie',
    extensions: ['mie'],
  },
  {
    key: 'application/x-mobipocket-ebook',
    extensions: ['prc', 'mobi'],
  },
  {
    key: 'application/x-ms-application',
    extensions: ['application'],
  },
  {
    key: 'application/x-ms-shortcut',
    extensions: ['lnk'],
  },
  {
    key: 'application/x-ms-wmd',
    extensions: ['wmd'],
  },
  {
    key: 'application/x-ms-wmz',
    extensions: ['wmz'],
  },
  {
    key: 'application/x-ms-xbap',
    extensions: ['xbap'],
  },
  {
    key: 'application/x-msaccess',
    extensions: ['mdb'],
  },
  {
    key: 'application/x-msbinder',
    extensions: ['obd'],
  },
  {
    key: 'application/x-mscardfile',
    extensions: ['crd'],
  },
  {
    key: 'application/x-msclip',
    extensions: ['clp'],
  },
  {
    key: 'application/x-msdos-program',
    extensions: ['exe'],
  },
  {
    key: 'application/x-msdownload',
    extensions: ['exe', 'dll', 'com', 'bat', 'msi'],
  },
  {
    key: 'application/x-msmediaview',
    extensions: ['mvb', 'm13', 'm14'],
  },
  {
    key: 'application/x-msmetafile',
    extensions: ['wmf', 'wmz', 'emf', 'emz'],
  },
  {
    key: 'application/x-msmoney',
    extensions: ['mny'],
  },
  {
    key: 'application/x-mspublisher',
    extensions: ['pub'],
  },
  {
    key: 'application/x-msschedule',
    extensions: ['scd'],
  },
  {
    key: 'application/x-msterminal',
    extensions: ['trm'],
  },
  {
    key: 'application/x-mswrite',
    extensions: ['wri'],
  },
  {
    key: 'application/x-netcdf',
    extensions: ['nc', 'cdf'],
  },
  {
    key: 'application/x-ns-proxy-autoconfig',
    extensions: ['pac'],
  },
  {
    key: 'application/x-nzb',
    extensions: ['nzb'],
  },
  {
    key: 'application/x-perl',
    extensions: ['pl', 'pm'],
  },
  {
    key: 'text/x-perl',
    extensions: ['pl', 'pm'],
  },
  {
    key: 'application/x-pilot',
    extensions: ['prc', 'pdb'],
  },
  {
    key: 'application/x-pkcs12',
    extensions: ['p12', 'pfx'],
  },
  {
    key: 'application/x-pkcs7-certificates',
    extensions: ['p7b', 'spc'],
  },
  {
    key: 'application/x-pkcs7-certreqresp',
    extensions: ['p7r'],
  },
  {
    key: 'application/x-rar-compressed',
    extensions: ['rar'],
  },
  {
    key: 'application/x-redhat-package-manager',
    extensions: ['rpm'],
  },
  {
    key: 'application/x-research-info-systems',
    extensions: ['ris'],
  },
  {
    key: 'application/x-sea',
    extensions: ['sea'],
  },
  {
    key: 'application/x-sh',
    extensions: ['sh'],
  },
  {
    key: 'text/x-sh',
    extensions: ['sh', 'bash'],
  },
  {
    key: 'application/x-shar',
    extensions: ['shar'],
  },
  {
    key: 'application/x-shockwave-flash',
    extensions: ['swf'],
  },
  {
    key: 'application/x-silverlight-app',
    extensions: ['xap'],
  },
  {
    key: 'application/x-sql',
    extensions: ['sql'],
  },
  {
    key: 'application/x-stuffit',
    extensions: ['sit'],
  },
  {
    key: 'application/x-stuffitx',
    extensions: ['sitx'],
  },
  {
    key: 'application/x-subrip',
    extensions: ['srt'],
  },
  {
    key: 'application/x-sv4cpio',
    extensions: ['sv4cpio'],
  },
  {
    key: 'application/x-sv4crc',
    extensions: ['sv4crc'],
  },
  {
    key: 'application/x-t3vm-image',
    extensions: ['t3'],
  },
  {
    key: 'application/x-tads',
    extensions: ['gam'],
  },
  {
    key: 'application/x-tar',
    extensions: ['tar'],
  },
  {
    key: 'application/x-tcl',
    extensions: ['tcl', 'tk'],
  },
  {
    key: 'application/x-tex',
    extensions: ['tex'],
  },
  {
    key: 'application/x-tex-tfm',
    extensions: ['tfm'],
  },
  {
    key: 'application/x-texinfo',
    extensions: ['texinfo', 'texi'],
  },
  {
    key: 'application/x-tgif',
    extensions: ['obj'],
  },
  {
    key: 'application/x-ustar',
    extensions: ['ustar'],
  },
  {
    key: 'application/x-virtualbox-hdd',
    extensions: ['hdd'],
  },
  {
    key: 'application/x-virtualbox-ova',
    extensions: ['ova'],
  },
  {
    key: 'application/x-virtualbox-ovf',
    extensions: ['ovf'],
  },
  {
    key: 'application/x-virtualbox-vbox',
    extensions: ['vbox'],
  },
  {
    key: 'application/x-virtualbox-vbox-extpack',
    extensions: ['vbox-extpack'],
  },
  {
    key: 'application/x-virtualbox-vdi',
    extensions: ['vdi'],
  },
  {
    key: 'application/x-virtualbox-vhd',
    extensions: ['vhd'],
  },
  {
    key: 'application/x-virtualbox-vmdk',
    extensions: ['vmdk'],
  },
  {
    key: 'application/x-wais-source',
    extensions: ['src'],
  },
  {
    key: 'application/x-web-app-manifest+json',
    extensions: ['webapp'],
  },
  {
    key: 'application/x-x509-ca-cert',
    extensions: ['der', 'crt', 'pem'],
  },
  {
    key: 'application/x-xfig',
    extensions: ['fig'],
  },
  {
    key: 'application/x-xliff+xml',
    extensions: ['xlf'],
  },
  {
    key: 'application/x-xpinstall',
    extensions: ['xpi'],
  },
  {
    key: 'application/x-xz',
    extensions: ['xz'],
  },
  {
    key: 'application/x-zmachine',
    extensions: ['z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7', 'z8'],
  },
  {
    key: 'application/xaml+xml',
    extensions: ['xaml'],
  },
  {
    key: 'application/xcap-att+xml',
    extensions: ['xav'],
  },
  {
    key: 'application/xcap-caps+xml',
    extensions: ['xca'],
  },
  {
    key: 'application/xcap-diff+xml',
    extensions: ['xdf'],
  },
  {
    key: 'application/xcap-el+xml',
    extensions: ['xel'],
  },
  {
    key: 'application/xcap-ns+xml',
    extensions: ['xns'],
  },
  {
    key: 'application/xenc+xml',
    extensions: ['xenc'],
  },
  {
    key: 'application/xfdf',
    extensions: ['xfdf'],
  },
  {
    key: 'application/xhtml+xml',
    extensions: ['xhtml', 'xht'],
  },
  {
    key: 'application/xliff+xml',
    extensions: ['xlf'],
  },
  {
    key: 'application/xml',
    extensions: ['xml', 'xsl', 'xsd', 'rng'],
  },
  {
    key: 'application/xml-dtd',
    extensions: ['dtd'],
  },
  {
    key: 'application/xop+xml',
    extensions: ['xop'],
  },
  {
    key: 'application/xproc+xml',
    extensions: ['xpl'],
  },
  {
    key: 'application/xslt+xml',
    extensions: ['xsl', 'xslt'],
  },
  {
    key: 'application/xspf+xml',
    extensions: ['xspf'],
  },
  {
    key: 'application/xv+xml',
    extensions: ['mxml', 'xhvml', 'xvml', 'xvm'],
  },
  {
    key: 'application/x-yaml',
    extensions: ['yaml', 'yml'],
  },
  {
    key: 'application/yang',
    extensions: ['yang'],
  },
  {
    key: 'application/yaml',
    extensions: ['yaml', 'yml'],
  },
  {
    key: 'application/yin+xml',
    extensions: ['yin'],
  },
  {
    key: 'application/zip',
    extensions: ['zip'],
  },
  {
    key: 'application/typescript',
    extensions: ['ts'],
  },
  {
    key: 'text/x-typescript',
    extensions: ['ts'],
  },
  {
    key: 'application/x-python-code',
    extensions: ['py', 'pyw'],
  },
  {
    key: 'application/x-python-script',
    extensions: ['py', 'pyw'],
  },
  {
    key: 'audio/3gpp',
    extensions: ['3gpp'],
  },
  {
    key: 'audio/aac',
    extensions: ['adts', 'aac'],
  },
  {
    key: 'audio/adpcm',
    extensions: ['adp'],
  },
  {
    key: 'audio/amr',
    extensions: ['amr'],
  },
  {
    key: 'audio/basic',
    extensions: ['au', 'snd'],
  },
  {
    key: 'audio/midi',
    extensions: ['mid', 'midi', 'kar', 'rmi'],
  },
  {
    key: 'audio/mobile-xmf',
    extensions: ['mxmf'],
  },
  {
    key: 'audio/mp3',
    extensions: ['mp3'],
  },
  {
    key: 'audio/mp4',
    extensions: ['m4a', 'mp4a'],
  },
  {
    key: 'audio/mpeg',
    extensions: ['mpga', 'mp2', 'mp2a', 'mp3', 'm2a', 'm3a'],
  },
  {
    key: 'audio/ogg',
    extensions: ['oga', 'ogg', 'spx', 'opus'],
  },
  {
    key: 'audio/s3m',
    extensions: ['s3m'],
  },
  {
    key: 'audio/silk',
    extensions: ['sil'],
  },
  {
    key: 'audio/vnd.dece.audio',
    extensions: ['uva', 'uvva'],
  },
  {
    key: 'audio/vnd.digital-winds',
    extensions: ['eol'],
  },
  {
    key: 'audio/vnd.dra',
    extensions: ['dra'],
  },
  {
    key: 'audio/vnd.dts',
    extensions: ['dts'],
  },
  {
    key: 'audio/vnd.dts.hd',
    extensions: ['dtshd'],
  },
  {
    key: 'audio/vnd.lucent.voice',
    extensions: ['lvp'],
  },
  {
    key: 'audio/vnd.ms-playready.media.pya',
    extensions: ['pya'],
  },
  {
    key: 'audio/vnd.nuera.ecelp4800',
    extensions: ['ecelp4800'],
  },
  {
    key: 'audio/vnd.nuera.ecelp7470',
    extensions: ['ecelp7470'],
  },
  {
    key: 'audio/vnd.nuera.ecelp9600',
    extensions: ['ecelp9600'],
  },
  {
    key: 'audio/vnd.rip',
    extensions: ['rip'],
  },
  {
    key: 'audio/wav',
    extensions: ['wav'],
  },
  {
    key: 'audio/wave',
    extensions: ['wav'],
  },
  {
    key: 'audio/webm',
    extensions: ['weba'],
  },
  {
    key: 'audio/x-aac',
    extensions: ['aac'],
  },
  {
    key: 'audio/x-aiff',
    extensions: ['aif', 'aiff', 'aifc'],
  },
  {
    key: 'audio/x-caf',
    extensions: ['caf'],
  },
  {
    key: 'audio/x-flac',
    extensions: ['flac'],
  },
  {
    key: 'audio/x-m4a',
    extensions: ['m4a'],
  },
  {
    key: 'audio/x-matroska',
    extensions: ['mka'],
  },
  {
    key: 'audio/x-mpegurl',
    extensions: ['m3u'],
  },
  {
    key: 'audio/x-ms-wax',
    extensions: ['wax'],
  },
  {
    key: 'audio/x-ms-wma',
    extensions: ['wma'],
  },
  {
    key: 'audio/x-pn-realaudio',
    extensions: ['ram', 'ra'],
  },
  {
    key: 'audio/x-pn-realaudio-plugin',
    extensions: ['rmp'],
  },
  {
    key: 'audio/x-realaudio',
    extensions: ['ra'],
  },
  {
    key: 'audio/x-wav',
    extensions: ['wav'],
  },
  {
    key: 'audio/xm',
    extensions: ['xm'],
  },
  {
    key: 'chemical/x-cdx',
    extensions: ['cdx'],
  },
  {
    key: 'chemical/x-cif',
    extensions: ['cif'],
  },
  {
    key: 'chemical/x-cmdf',
    extensions: ['cmdf'],
  },
  {
    key: 'chemical/x-cml',
    extensions: ['cml'],
  },
  {
    key: 'chemical/x-csml',
    extensions: ['csml'],
  },
  {
    key: 'chemical/x-xyz',
    extensions: ['xyz'],
  },
  {
    key: 'font/collection',
    extensions: ['ttc'],
  },
  {
    key: 'font/otf',
    extensions: ['otf'],
  },
  {
    key: 'font/ttf',
    extensions: ['ttf'],
  },
  {
    key: 'font/woff',
    extensions: ['woff'],
  },
  {
    key: 'font/woff2',
    extensions: ['woff2'],
  },
  {
    key: 'image/aces',
    extensions: ['exr'],
  },
  {
    key: 'image/apng',
    extensions: ['apng'],
  },
  {
    key: 'image/avci',
    extensions: ['avci'],
  },
  {
    key: 'image/avcs',
    extensions: ['avcs'],
  },
  {
    key: 'image/avif',
    extensions: ['avif'],
  },
  {
    key: 'image/bmp',
    extensions: ['bmp', 'dib'],
  },
  {
    key: 'image/cgm',
    extensions: ['cgm'],
  },
  {
    key: 'image/dicom-rle',
    extensions: ['drle'],
  },
  {
    key: 'image/dpx',
    extensions: ['dpx'],
  },
  {
    key: 'image/emf',
    extensions: ['emf'],
  },
  {
    key: 'image/fits',
    extensions: ['fits'],
  },
  {
    key: 'image/g3fax',
    extensions: ['g3'],
  },
  {
    key: 'image/gif',
    extensions: ['gif'],
  },
  {
    key: 'image/heic',
    extensions: ['heic'],
  },
  {
    key: 'image/heic-sequence',
    extensions: ['heics'],
  },
  {
    key: 'image/heif',
    extensions: ['heif'],
  },
  {
    key: 'image/heif-sequence',
    extensions: ['heifs'],
  },
  {
    key: 'image/hej2k',
    extensions: ['hej2'],
  },
  {
    key: 'image/hsj2',
    extensions: ['hsj2'],
  },
  {
    key: 'image/ief',
    extensions: ['ief'],
  },
  {
    key: 'image/jls',
    extensions: ['jls'],
  },
  {
    key: 'image/jp2',
    extensions: ['jp2', 'jpg2'],
  },
  {
    key: 'image/jpeg',
    extensions: ['jpeg', 'jpg', 'jpe'],
  },
  {
    key: 'image/jph',
    extensions: ['jph'],
  },
  {
    key: 'image/jphc',
    extensions: ['jhc'],
  },
  {
    key: 'image/jpm',
    extensions: ['jpm', 'jpgm'],
  },
  {
    key: 'image/jpx',
    extensions: ['jpx', 'jpf'],
  },
  {
    key: 'image/jxl',
    extensions: ['jxl'],
  },
  {
    key: 'image/jxr',
    extensions: ['jxr'],
  },
  {
    key: 'image/jxra',
    extensions: ['jxra'],
  },
  {
    key: 'image/jxrs',
    extensions: ['jxrs'],
  },
  {
    key: 'image/jxs',
    extensions: ['jxs'],
  },
  {
    key: 'image/jxsc',
    extensions: ['jxsc'],
  },
  {
    key: 'image/jxsi',
    extensions: ['jxsi'],
  },
  {
    key: 'image/jxss',
    extensions: ['jxss'],
  },
  {
    key: 'image/ktx',
    extensions: ['ktx'],
  },
  {
    key: 'image/ktx2',
    extensions: ['ktx2'],
  },
  {
    key: 'image/png',
    extensions: ['png'],
  },
  {
    key: 'image/prs.btif',
    extensions: ['btif', 'btf'],
  },
  {
    key: 'image/prs.pti',
    extensions: ['pti'],
  },
  {
    key: 'image/sgi',
    extensions: ['sgi'],
  },
  {
    key: 'image/svg+xml',
    extensions: ['svg', 'svgz'],
  },
  {
    key: 'image/t38',
    extensions: ['t38'],
  },
  {
    key: 'image/tiff',
    extensions: ['tif', 'tiff'],
  },
  {
    key: 'image/tiff-fx',
    extensions: ['tfx'],
  },
  {
    key: 'image/vnd.adobe.photoshop',
    extensions: ['psd'],
  },
  {
    key: 'image/vnd.airzip.accelerator.azv',
    extensions: ['azv'],
  },
  {
    key: 'image/vnd.dece.graphic',
    extensions: ['uvi', 'uvvi', 'uvg', 'uvvg'],
  },
  {
    key: 'image/vnd.djvu',
    extensions: ['djvu', 'djv'],
  },
  {
    key: 'image/vnd.dvb.subtitle',
    extensions: ['sub'],
  },
  {
    key: 'image/vnd.dwg',
    extensions: ['dwg'],
  },
  {
    key: 'image/vnd.dxf',
    extensions: ['dxf'],
  },
  {
    key: 'image/vnd.fastbidsheet',
    extensions: ['fbs'],
  },
  {
    key: 'image/vnd.fpx',
    extensions: ['fpx'],
  },
  {
    key: 'image/vnd.fst',
    extensions: ['fst'],
  },
  {
    key: 'image/vnd.fujixerox.edmics-mmr',
    extensions: ['mmr'],
  },
  {
    key: 'image/vnd.fujixerox.edmics-rlc',
    extensions: ['rlc'],
  },
  {
    key: 'image/vnd.microsoft.icon',
    extensions: ['ico'],
  },
  {
    key: 'image/vnd.ms-dds',
    extensions: ['dds'],
  },
  {
    key: 'image/vnd.ms-modi',
    extensions: ['mdi'],
  },
  {
    key: 'image/vnd.ms-photo',
    extensions: ['wdp'],
  },
  {
    key: 'image/vnd.net-fpx',
    extensions: ['npx'],
  },
  {
    key: 'image/vnd.pco.b16',
    extensions: ['b16'],
  },
  {
    key: 'image/vnd.tencent.tap',
    extensions: ['tap'],
  },
  {
    key: 'image/vnd.valve.source.texture',
    extensions: ['vtf'],
  },
  {
    key: 'image/vnd.wap.wbmp',
    extensions: ['wbmp'],
  },
  {
    key: 'image/vnd.xiff',
    extensions: ['xif'],
  },
  {
    key: 'image/vnd.zbrush.pcx',
    extensions: ['pcx'],
  },
  {
    key: 'image/webp',
    extensions: ['webp'],
  },
  {
    key: 'image/wmf',
    extensions: ['wmf'],
  },
  {
    key: 'image/x-3ds',
    extensions: ['3ds'],
  },
  {
    key: 'image/x-cmu-raster',
    extensions: ['ras'],
  },
  {
    key: 'image/x-cmx',
    extensions: ['cmx'],
  },
  {
    key: 'image/x-freehand',
    extensions: ['fh', 'fhc', 'fh4', 'fh5', 'fh7'],
  },
  {
    key: 'image/x-icon',
    extensions: ['ico'],
  },
  {
    key: 'image/x-jng',
    extensions: ['jng'],
  },
  {
    key: 'image/x-mrsid-image',
    extensions: ['sid'],
  },
  {
    key: 'image/x-ms-bmp',
    extensions: ['bmp'],
  },
  {
    key: 'image/x-pcx',
    extensions: ['pcx'],
  },
  {
    key: 'image/x-pict',
    extensions: ['pic', 'pct'],
  },
  {
    key: 'image/x-portable-anymap',
    extensions: ['pnm'],
  },
  {
    key: 'image/x-portable-bitmap',
    extensions: ['pbm'],
  },
  {
    key: 'image/x-portable-graymap',
    extensions: ['pgm'],
  },
  {
    key: 'image/x-portable-pixmap',
    extensions: ['ppm'],
  },
  {
    key: 'image/x-rgb',
    extensions: ['rgb'],
  },
  {
    key: 'image/x-tga',
    extensions: ['tga'],
  },
  {
    key: 'image/x-xbitmap',
    extensions: ['xbm'],
  },
  {
    key: 'image/x-xpixmap',
    extensions: ['xpm'],
  },
  {
    key: 'image/x-xwindowdump',
    extensions: ['xwd'],
  },
  {
    key: 'message/disposition-notification',
    extensions: ['disposition-notification'],
  },
  {
    key: 'message/global',
    extensions: ['u8msg'],
  },
  {
    key: 'message/global-delivery-status',
    extensions: ['u8dsn'],
  },
  {
    key: 'message/global-disposition-notification',
    extensions: ['u8mdn'],
  },
  {
    key: 'message/global-headers',
    extensions: ['u8hdr'],
  },
  {
    key: 'message/rfc822',
    extensions: ['eml', 'mime'],
  },
  {
    key: 'message/vnd.wfa.wsc',
    extensions: ['wsc'],
  },
  {
    key: 'model/3mf',
    extensions: ['3mf'],
  },
  {
    key: 'model/gltf+json',
    extensions: ['gltf'],
  },
  {
    key: 'model/gltf-binary',
    extensions: ['glb'],
  },
  {
    key: 'model/iges',
    extensions: ['igs', 'iges'],
  },
  {
    key: 'model/jt',
    extensions: ['jt'],
  },
  {
    key: 'model/mesh',
    extensions: ['msh', 'mesh', 'silo'],
  },
  {
    key: 'model/mtl',
    extensions: ['mtl'],
  },
  {
    key: 'model/obj',
    extensions: ['obj'],
  },
  {
    key: 'model/prc',
    extensions: ['prc'],
  },
  {
    key: 'model/step+xml',
    extensions: ['stpx'],
  },
  {
    key: 'model/step+zip',
    extensions: ['stpz'],
  },
  {
    key: 'model/step-xml+zip',
    extensions: ['stpxz'],
  },
  {
    key: 'model/stl',
    extensions: ['stl'],
  },
  {
    key: 'model/u3d',
    extensions: ['u3d'],
  },
  {
    key: 'model/vnd.bary',
    extensions: ['bary'],
  },
  {
    key: 'model/vnd.cld',
    extensions: ['cld'],
  },
  {
    key: 'model/vnd.collada+xml',
    extensions: ['dae'],
  },
  {
    key: 'model/vnd.dwf',
    extensions: ['dwf'],
  },
  {
    key: 'model/vnd.gdl',
    extensions: ['gdl'],
  },
  {
    key: 'model/vnd.gtw',
    extensions: ['gtw'],
  },
  {
    key: 'model/vnd.mts',
    extensions: ['mts'],
  },
  {
    key: 'model/vnd.opengex',
    extensions: ['ogex'],
  },
  {
    key: 'model/vnd.parasolid.transmit.binary',
    extensions: ['x_b'],
  },
  {
    key: 'model/vnd.parasolid.transmit.text',
    extensions: ['x_t'],
  },
  {
    key: 'model/vnd.pytha.pyox',
    extensions: ['pyo', 'pyox'],
  },
  {
    key: 'model/vnd.sap.vds',
    extensions: ['vds'],
  },
  {
    key: 'model/vnd.usda',
    extensions: ['usda'],
  },
  {
    key: 'model/vnd.usdz+zip',
    extensions: ['usdz'],
  },
  {
    key: 'model/vnd.valve.source.compiled-map',
    extensions: ['bsp'],
  },
  {
    key: 'model/vnd.vtu',
    extensions: ['vtu'],
  },
  {
    key: 'model/vrml',
    extensions: ['wrl', 'vrml'],
  },
  {
    key: 'model/x3d+binary',
    extensions: ['x3db', 'x3dbz'],
  },
  {
    key: 'model/x3d+fastinfoset',
    extensions: ['x3db'],
  },
  {
    key: 'model/x3d+vrml',
    extensions: ['x3dv', 'x3dvz'],
  },
  {
    key: 'model/x3d+xml',
    extensions: ['x3d', 'x3dz'],
  },
  {
    key: 'model/x3d-vrml',
    extensions: ['x3dv'],
  },
  {
    key: 'text/cache-manifest',
    extensions: ['appcache', 'manifest'],
  },
  {
    key: 'text/calendar',
    extensions: ['ics', 'ifb'],
  },
  {
    key: 'text/coffeescript',
    extensions: ['coffee', 'litcoffee'],
  },
  {
    key: 'text/css',
    extensions: ['css'],
  },
  {
    key: 'text/csv',
    extensions: ['csv'],
  },
  {
    key: 'text/html',
    extensions: ['html', 'htm', 'shtml'],
  },
  {
    key: 'text/jade',
    extensions: ['jade'],
  },
  {
    key: 'text/javascript',
    extensions: ['js', 'mjs'],
  },
  {
    key: 'text/jsx',
    extensions: ['jsx'],
  },
  {
    key: 'text/less',
    extensions: ['less'],
  },
  {
    key: 'text/markdown',
    extensions: ['md', 'markdown'],
  },
  {
    key: 'text/mathml',
    extensions: ['mml'],
  },
  {
    key: 'text/mdx',
    extensions: ['mdx'],
  },
  {
    key: 'text/n3',
    extensions: ['n3'],
  },
  {
    key: 'text/plain',
    extensions: ['txt', 'text', 'conf', 'def', 'list', 'log', 'in', 'ini'],
  },
  {
    key: 'text/prs.lines.tag',
    extensions: ['dsc'],
  },
  {
    key: 'text/richtext',
    extensions: ['rtx'],
  },
  {
    key: 'text/rtf',
    extensions: ['rtf'],
  },
  {
    key: 'text/sgml',
    extensions: ['sgml', 'sgm'],
  },
  {
    key: 'text/shex',
    extensions: ['shex'],
  },
  {
    key: 'text/slim',
    extensions: ['slim', 'slm'],
  },
  {
    key: 'text/spdx',
    extensions: ['spdx'],
  },
  {
    key: 'text/stylus',
    extensions: ['stylus', 'styl'],
  },
  {
    key: 'text/tab-separated-values',
    extensions: ['tsv'],
  },
  {
    key: 'text/troff',
    extensions: ['t', 'tr', 'roff', 'man', 'me', 'ms'],
  },
  {
    key: 'text/turtle',
    extensions: ['ttl'],
  },
  {
    key: 'text/uri-list',
    extensions: ['uri', 'uris', 'urls'],
  },
  {
    key: 'text/vcard',
    extensions: ['vcard'],
  },
  {
    key: 'text/vnd.curl',
    extensions: ['curl'],
  },
  {
    key: 'text/vnd.curl.dcurl',
    extensions: ['dcurl'],
  },
  {
    key: 'text/vnd.curl.mcurl',
    extensions: ['mcurl'],
  },
  {
    key: 'text/vnd.curl.scurl',
    extensions: ['scurl'],
  },
  {
    key: 'text/vnd.dvb.subtitle',
    extensions: ['sub'],
  },
  {
    key: 'text/vnd.familysearch.gedcom',
    extensions: ['ged'],
  },
  {
    key: 'text/vnd.fly',
    extensions: ['fly'],
  },
  {
    key: 'text/vnd.fmi.flexstor',
    extensions: ['flx'],
  },
  {
    key: 'text/vnd.graphviz',
    extensions: ['gv'],
  },
  {
    key: 'text/vnd.in3d.3dml',
    extensions: ['3dml'],
  },
  {
    key: 'text/vnd.in3d.spot',
    extensions: ['spot'],
  },
  {
    key: 'text/vnd.sun.j2me.app-descriptor',
    extensions: ['jad'],
  },
  {
    key: 'text/vnd.wap.wml',
    extensions: ['wml'],
  },
  {
    key: 'text/vnd.wap.wmlscript',
    extensions: ['wmls'],
  },
  {
    key: 'text/vtt',
    extensions: ['vtt'],
  },
  {
    key: 'text/wgsl',
    extensions: ['wgsl'],
  },
  {
    key: 'text/x-asm',
    extensions: ['s', 'asm'],
  },
  {
    key: 'text/x-c',
    extensions: ['c', 'cc', 'cxx', 'cpp', 'h', 'hh', 'hpp', 'hxx', 'dic'],
  },
  {
    key: 'text/x-csrc',
    extensions: ['c', 'h'],
  },
  {
    key: 'text/x-c++',
    extensions: ['cpp', 'cxx', 'cc', 'hpp', 'hxx'],
  },
  {
    key: 'text/x-c++src',
    extensions: ['cpp', 'cxx', 'cc', 'hpp', 'hxx'],
  },
  {
    key: 'text/x-component',
    extensions: ['htc'],
  },
  {
    key: 'text/x-fortran',
    extensions: ['f', 'for', 'f77', 'f90'],
  },
  {
    key: 'text/x-handlebars-template',
    extensions: ['hbs'],
  },
  {
    key: 'text/x-java-source',
    extensions: ['java'],
  },
  {
    key: 'text/x-java',
    extensions: ['java'],
  },
  {
    key: 'text/x-lua',
    extensions: ['lua'],
  },
  {
    key: 'text/x-markdown',
    extensions: ['mkd'],
  },
  {
    key: 'text/x-python',
    extensions: ['py', 'pyw', 'pyc', 'pyo', 'pyd', 'pyi', 'pyz', 'pyzw'],
  },
  {
    key: 'text/x-python-code',
    extensions: ['py', 'pyw'],
  },
  {
    key: 'text/x-python-script',
    extensions: ['py', 'pyw'],
  },
  {
    key: 'text/x-ruby',
    extensions: ['rb', 'rbw'],
  },
  {
    key: 'text/x-go',
    extensions: ['go'],
  },
  {
    key: 'text/rust',
    extensions: ['rs'],
  },
  {
    key: 'text/x-rustsrc',
    extensions: ['rs'],
  },
  {
    key: 'text/x-kotlin',
    extensions: ['kt', 'kts'],
  },
  {
    key: 'text/swift',
    extensions: ['swift'],
  },
  {
    key: 'text/x-swift',
    extensions: ['swift'],
  },
  {
    key: 'text/x-scala',
    extensions: ['scala', 'sc'],
  },
  {
    key: 'text/x-csharp',
    extensions: ['cs'],
  },
  {
    key: 'text/x-r',
    extensions: ['r', 'R'],
  },
  {
    key: 'text/x-rsrc',
    extensions: ['r', 'R'],
  },
  {
    key: 'text/x-powershell',
    extensions: ['ps1', 'psm1', 'psd1'],
  },
  {
    key: 'text/x-shellscript',
    extensions: ['bash', 'zsh', 'fish'],
  },
  {
    key: 'text/x-clojure',
    extensions: ['clj', 'cljs', 'cljc'],
  },
  {
    key: 'text/x-haskell',
    extensions: ['hs', 'lhs'],
  },
  {
    key: 'text/x-erlang',
    extensions: ['erl', 'hrl'],
  },
  {
    key: 'text/x-elixir',
    extensions: ['ex', 'exs'],
  },
  {
    key: 'text/x-tsx',
    extensions: ['tsx'],
  },
  {
    key: 'text/x-julia',
    extensions: ['jl'],
  },
  {
    key: 'text/x-visual-basic',
    extensions: ['vb', 'vbs', 'cls'],
  },
  {
    key: 'text/x-hcl',
    extensions: ['hcl', 'tf', 'tfvars'],
  },
  {
    key: 'text/x-graphql',
    extensions: ['graphql', 'gql'],
  },
  {
    key: 'text/x-common-lisp',
    extensions: ['lisp', 'lsp'],
  },
  {
    key: 'text/x-vhdl',
    extensions: ['vhdl', 'vhd'],
  },
  {
    key: 'text/x-verilog',
    extensions: ['v', 'sv'],
  },
  {
    key: 'text/x-mathematica',
    extensions: ['nb', 'wl'],
  },
  {
    key: 'text/x-liquid',
    extensions: ['liquid'],
  },
  {
    key: 'text/x-dockerfile',
    extensions: ['dockerfile'],
  },
  {
    key: 'text/x-diff',
    extensions: ['diff', 'patch'],
  },
  {
    key: 'text/x-nfo',
    extensions: ['nfo'],
  },
  {
    key: 'text/x-opml',
    extensions: ['opml'],
  },
  {
    key: 'text/x-org',
    extensions: ['org'],
  },
  {
    key: 'text/x-pascal',
    extensions: ['p', 'pas'],
  },
  {
    key: 'text/x-processing',
    extensions: ['pde'],
  },
  {
    key: 'text/x-sass',
    extensions: ['sass'],
  },
  {
    key: 'text/x-scss',
    extensions: ['scss'],
  },
  {
    key: 'text/x-setext',
    extensions: ['etx'],
  },
  {
    key: 'text/x-sfv',
    extensions: ['sfv'],
  },
  {
    key: 'text/x-suse-ymp',
    extensions: ['ymp'],
  },
  {
    key: 'text/x-uuencode',
    extensions: ['uu'],
  },
  {
    key: 'text/x-vcalendar',
    extensions: ['vcs'],
  },
  {
    key: 'text/x-vcard',
    extensions: ['vcf'],
  },
  {
    key: 'text/xml',
    extensions: ['xml'],
  },
  {
    key: 'text/yaml',
    extensions: ['yaml', 'yml'],
  },
  {
    key: 'video/3gpp',
    extensions: ['3gp', '3gpp'],
  },
  {
    key: 'video/3gpp2',
    extensions: ['3g2'],
  },
  {
    key: 'video/h261',
    extensions: ['h261'],
  },
  {
    key: 'video/h263',
    extensions: ['h263'],
  },
  {
    key: 'video/h264',
    extensions: ['h264'],
  },
  {
    key: 'video/iso.segment',
    extensions: ['m4s'],
  },
  {
    key: 'video/jpeg',
    extensions: ['jpgv'],
  },
  {
    key: 'video/jpm',
    extensions: ['jpm', 'jpgm'],
  },
  {
    key: 'video/mj2',
    extensions: ['mj2', 'mjp2'],
  },
  {
    key: 'video/mp2t',
    extensions: ['ts', 'm2t', 'm2ts', 'mts'],
  },
  {
    key: 'video/mp4',
    extensions: ['mp4', 'mp4v', 'mpg4'],
  },
  {
    key: 'video/mpeg',
    extensions: ['mpeg', 'mpg', 'mpe', 'm1v', 'm2v'],
  },
  {
    key: 'video/ogg',
    extensions: ['ogv'],
  },
  {
    key: 'video/quicktime',
    extensions: ['qt', 'mov'],
  },
  {
    key: 'video/vnd.dece.hd',
    extensions: ['uvh', 'uvvh'],
  },
  {
    key: 'video/vnd.dece.mobile',
    extensions: ['uvm', 'uvvm'],
  },
  {
    key: 'video/vnd.dece.pd',
    extensions: ['uvp', 'uvvp'],
  },
  {
    key: 'video/vnd.dece.sd',
    extensions: ['uvs', 'uvvs'],
  },
  {
    key: 'video/vnd.dece.video',
    extensions: ['uvv', 'uvvv'],
  },
  {
    key: 'video/vnd.dvb.file',
    extensions: ['dvb'],
  },
  {
    key: 'video/vnd.fvt',
    extensions: ['fvt'],
  },
  {
    key: 'video/vnd.mpegurl',
    extensions: ['mxu', 'm4u'],
  },
  {
    key: 'video/vnd.ms-playready.media.pyv',
    extensions: ['pyv'],
  },
  {
    key: 'video/vnd.uvvu.mp4',
    extensions: ['uvu', 'uvvu'],
  },
  {
    key: 'video/vnd.vivo',
    extensions: ['viv'],
  },
  {
    key: 'video/webm',
    extensions: ['webm'],
  },
  {
    key: 'video/x-f4v',
    extensions: ['f4v'],
  },
  {
    key: 'video/x-fli',
    extensions: ['fli'],
  },
  {
    key: 'video/x-flv',
    extensions: ['flv'],
  },
  {
    key: 'video/x-m4v',
    extensions: ['m4v'],
  },
  {
    key: 'video/x-matroska',
    extensions: ['mkv', 'mk3d', 'mks'],
  },
  {
    key: 'video/x-mng',
    extensions: ['mng'],
  },
  {
    key: 'video/x-ms-asf',
    extensions: ['asf', 'asx'],
  },
  {
    key: 'video/x-ms-vob',
    extensions: ['vob'],
  },
  {
    key: 'video/x-ms-wm',
    extensions: ['wm'],
  },
  {
    key: 'video/x-ms-wmv',
    extensions: ['wmv'],
  },
  {
    key: 'video/x-ms-wmx',
    extensions: ['wmx'],
  },
  {
    key: 'video/x-ms-wvx',
    extensions: ['wvx'],
  },
  {
    key: 'video/x-msvideo',
    extensions: ['avi'],
  },
  {
    key: 'video/x-sgi-movie',
    extensions: ['movie'],
  },
  {
    key: 'video/x-smv',
    extensions: ['smv'],
  },
  {
    key: 'x-conference/x-cooltalk',
    extensions: ['ice'],
  },
]

const EXCEPTIONS = ['dll']

const typeToExtensions = Object.freeze(
  entries.reduce((acc, { key, extensions }) => {
    acc.set(key, extensions)
    return acc
  }, new Map<string, string[]>())
)

const extensionToMime = Object.freeze(
  entries.reduce((acc, { key, extensions }) => {
    extensions.forEach((extension) => {
      acc.set(extension, key)
    })
    return acc
  }, new Map<string, string>())
)

function getType(path: string | undefined): string | undefined {
  if (!path) return undefined
  const last = path.replace(/^.*[/\\]/, '').toLowerCase()
  const extension = last.replace(/^.*\./, '').toLowerCase()

  const hasPath = last.length < path.length
  const hasDot = extension.length < last.length - 1

  if (!hasDot && hasPath) return undefined
  if (EXCEPTIONS.includes(extension)) return `unknown/${extension}`
  return extensionToMime.get(extension) ?? `unknown/${extension}`
}

function getExtensions(type: string | undefined): string[] | undefined {
  if (!type) return undefined
  type = type.split(';')[0]
  if (!type) return undefined
  if (type.startsWith('unknown/')) return type.split('unknown/').slice(1)
  return typeToExtensions.get(type.trim().toLowerCase())
}

function getExtension(type: string | undefined): string | undefined {
  if (!type) return undefined
  return getExtensions(type)?.[0]
}

export default {
  getType,
  getExtensions,
  getExtension,
}
