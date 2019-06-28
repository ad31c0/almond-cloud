// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const express = require('express');

const db = require('../util/db');
const user = require('../util/user');
const nlpModelsModel = require('../model/nlp_models');
const templateModel = require('../model/template_files');
const schemaModel = require('../model/schema');
const iv = require('../util/input_validation');
const { BadRequestError } = require('../util/errors');
const I18n = require('../util/i18n');
const { makeRandom } = require('../util/random');

const router = express.Router();

router.post('/create', user.requireLogIn, user.requireDeveloper(),
    iv.validatePOST({ tag: 'string', language: 'string', template: 'string', flags: '?string',
                      for_devices: '?string', use_approved: 'boolean', public: 'boolean' }), (req, res, next) => {
    if (!I18n.get(req.body.language))
        throw new BadRequestError(req._("Unsupported language"));
    const language = I18n.localeToLanguage(req.body.language);

    db.withTransaction(async (dbClient) => {
        let template;
        try {
            template = await templateModel.getByTag(dbClient, language, req.body.template);
        } catch(e) {
            if (e.code !== 'ENOENT')
                throw e;
            throw new BadRequestError(req._("No such template pack %s").format(req.body.template));
        }

        if (req.body.flags && !/^[a-zA-Z_][0-9a-zA-Z_]*(?:[ ,][a-zA-Z_][0-9a-zA-Z_]*)*$/.test(req.body.flags))
            throw new BadRequestError(req._("Invalid flags"));

        const flags = req.body.flags ? req.body.flags.split(/[ ,]/g) : [];

        // remove the turking flag if specified (it has a special meaning related to mturk)
        const turkingIdx = flags.indexOf('turking');
        if (turkingIdx >= 0)
            flags.splice(turkingIdx, 1);

        const allowedFlags = new Set(JSON.parse(template.flags));
        for (let f of flags) {
            if (!allowedFlags.has(f))
                throw new BadRequestError(req._("The template %s does not support the flag %s").format(req.body.template, f));
        }

        if (req.body.for_devices && !/^[a-zA-Z_][0-9a-zA-Z_.-]*(?:[ ,][a-zA-Z_][0-9a-zA-Z_.-]*)*$/.test(req.body.for_devices))
            throw new BadRequestError(req._("Invalid device list"));

        const devices = req.body.for_devices ? req.body.for_devices.split(/[ ,]/g) : [];
        const missing = await schemaModel.findNonExisting(dbClient, devices, req.user.developer_org);
        if (missing.length > 0)
            throw new BadRequestError(req._("The following devices do not exist or are not visible: %s").format(missing.join(req._(", "))));

        await nlpModelsModel.create(dbClient, {
            language,
            tag: req.body.tag,
            owner: req.user.developer_org,
            access_token: req.body.public ? null : makeRandom(32),
            template_file: template.id,
            flags: JSON.stringify(flags),
            all_devices: devices.length === 0,
            use_approved: !!req.body.use_approved,
        }, devices);

        res.redirect(303, '/developers/models');
    }).catch(next);
});

router.get('/', (req, res, next) => {
    db.withClient(async (dbClient) => {
        const models = await nlpModelsModel.getPublic(dbClient, user.isAuthenticated(req) ? req.user.developer_org : null);
        res.render('luinet_model_list', {
            page_title: req._("LUInet - Available Models"),
            models
        });
    }).catch(next);
});

module.exports = router;
