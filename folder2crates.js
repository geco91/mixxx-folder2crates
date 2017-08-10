const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

var mixxxSQLliteDatabasePath = "/Users/" + require("os").userInfo().username + "/Library/Application Support/Mixxx/mixxxdb.sqlite";
var musicFolderPath = "/Users/" + require("os").userInfo().username + "/Music/";

var db = new sqlite3.Database(mixxxSQLliteDatabasePath);

/* LOGIC */

// A) walk thru music folder and create crate datastructure from it

var crateArray = [];
var notListedTracks = [];

var walkSync = function (dir, crate, subFolderLevel) {

    if (typeof crate === "undefined") crate = null;
    if (typeof subFolderLevel === "undefined") subFolderLevel = 0;

    var files = fs.readdirSync(dir);
    files.forEach(function (file) {
        if (fs.statSync(dir + file).isDirectory()) {

            // DIRECTORY 

            // ignore some directoroes - e.g. when starts "x"
            if ((!file.toLowerCase().startsWith("x"))
                && (!file.toLowerCase().startsWith("."))
                && (file !== "iTunes")
                && (!file.toLowerCase().startsWith("_gsdata_"))) {

                // crate name is just the first subfolder in folder tree
                if (subFolderLevel === 0) {
                    var crateName = file;
                    if (crateName.startsWith("_")) crateName = crateName.substring(1);
                    if (crateName.startsWith("_")) crateName = crateName.substring(1);
                    console.log("******* " + crateName + " *******");
                    crate = { name: crateName, id: null, tracks: [] };
                    crateArray.push(crate);
                }

                subFolderLevel++;
                if (!file.toLowerCase().startsWith("x")) walkSync(dir + file + '/', crate, subFolderLevel);
                subFolderLevel--;

            } else {
                console.log("IGONRE FOLDER '" + file + "'");
            }

        }
        else {

            // FILE

            if ((file.toLowerCase().endsWith(".mp3")) || (file.toLowerCase().endsWith(".wav"))) {

                if (subFolderLevel > 0) {
                    console.log("TRACK (" + subFolderLevel + ") --> " + file);
                    crate.tracks.push({ filename: file, level: subFolderLevel, path: dir });
                }

            } else {
                console.log("NO MP3/WAV (" + file + ")");
            }

        }
    });
};
walkSync(musicFolderPath);

// B) Sync crate data structure with MIXXX database
console.log("################ SYNC WITH MIXXX DATABASE ##################");

var processCrate = function (crateArrayIndex, onDone) {

    // check if DONE
    if (crateArrayIndex >= crateArray.length) {
        onDone();
        return;
    }

    console.log("");
    console.log("#### CRATE: " + crateArray[crateArrayIndex].name);

    // get ID of crate from MIXXX database
    getCrateId(crateArray[crateArrayIndex].name, function (id) {
        // crate already exists
        console.log("ID on Database is " + id);
        crateArray[crateArrayIndex].id = id;

        processTracks(crateArray[crateArrayIndex], 0, function () {
            processCrate(++crateArrayIndex, onDone);
        });

    }, function () {
        // crate does not exists - add to MIXXX db
        console.log("No such crate in MIXXX databese - creating ...");

        createCrate(crateArray[crateArrayIndex].name, function (win) {
            console.log("... OK new crate created with id(" + win + ")");
            crateArray[crateArrayIndex].id = win;
            processTracks(crateArray[crateArrayIndex], 0, function () {
                processCrate(++crateArrayIndex, onDone);
            });
        }, function (fail) {
            console.log("FAILED TO CREATE CRATE (" + crateArray[crateArrayIndex].name + ")");
            process.exit();
        });
    });

};

var processTracks = function (crate, trackIndex, allDone) {

    if (trackIndex >= crate.tracks.length) {
        //console.log("<< CRATE DONE");
        allDone();
        return;
    }

    findTrackByFilename(crate.tracks[trackIndex].filename, function (loctaionId) {

        locationToTrackId(loctaionId, function (trackId) {
            crate.tracks[trackIndex].id = trackId;
            isTrackInCrate(crate.id, crate.tracks[trackIndex].id, function () {
                //console.log("      --> TRACK ALREADY IN CRATE");
                processTracks(crate, ++trackIndex, allDone);
            }, function () {
                console.log("TRACK --> " + crate.tracks[trackIndex].filename);
                console.log("      --> id(" + crate.tracks[trackIndex].id + ")");
                console.log("      --> ADDING TRACK TO CRATE");
                addTrackToCrate(crate.id, crate.tracks[trackIndex].id, function () {
                    console.log("      --> DONE");
                    getRatingOnTrack(crate.tracks[trackIndex].id, function (win) {
                        console.log("      --> HAS RATING: " + win);
                        if (win == 0) {
                            var rating = 4 - crate.tracks[trackIndex].level;
                            if (rating < 0) rating = 0;
                            setRatingOnTrack(crate.tracks[trackIndex].id, rating, function (win) {
                                console.log("      --> SET RATING: " + rating);
                                processTracks(crate, ++trackIndex, allDone);
                            }, function (fail) {
                                console.log("      --> !! FAILED TO SET REATING");
                                processTracks(crate, ++trackIndex, allDone);
                            });
                        } else {
                            console.log("      --> DONT OVERWRITE RATING");
                            processTracks(crate, ++trackIndex, allDone);
                        }
                    }, function (fail) {
                        console.log("      --> !! FAILED TO GET RATING");
                        processTracks(crate, ++trackIndex, allDone);
                    });

                }, function () {
                    console.log("!! FAILED TO ADD TRACK TO CRATE(" + crate.id + ")");
                    console.log(JSON.stringify(crate.tracks[trackIndex]));
                    process.exit();
                });
            });

        }, function (fail) {
            console.log("!! WAS NOT ABLE TO FINDLOCATIONID(" + loctaionId + " IN LIBRARY");
            process.exit();
        });

    }, function () {
        notListedTracks.push(crate.tracks[trackIndex]);
        console.log("TRACK --> " + crate.tracks[trackIndex].filename);
        console.log("      --> NOT FOUND");
        processTracks(crate, ++trackIndex, allDone);
    });

};

processCrate(0, function () {
    console.log("*********************");
    if (notListedTracks.length > 0) {
        notListedTracks.forEach(function (track) {
            console.log("**** NOT FOUND IN MIXXX DATABASE ****");
            console.log(JSON.stringify(track));
        });
        console.log("--> START MIXXX, RESCAN LIBRARY AND TRY AGAIN");
        console.log("--> IF STILL NOT FOUND RENAME FILE");
    }
    console.log("******* DONE ********");
});

/* FUNCTIONS */

function getCrateId(crateName, win, fail) {
    db.get("SELECT id FROM crates WHERE name=?", { 1: crateName }, function (err, row) {

        // in case of error
        if (err != null) {
            fail();
            return;
        }

        // test result
        if (typeof row !== "undefined") {
            // WIN
            win(row.id);
        } else {
            // FAIL
            fail();
        }

    });
};

function createCrate(crateName, win, fail) {

    var request = db.run("INSERT INTO crates ('name', 'count', 'show', 'locked') VALUES (?, ?, ?, ?)", [crateName, 0, 1, 0], function (info) {
        if (info === null) {
            win(this.lastID);
        } else {
            fail(JSON.stringify(info));
        }
    });

};

function findTrackByFilename(filename, win, fail) {

    db.get("SELECT id FROM track_locations WHERE filename=?", [filename], function (err, row) {

        // in case of error
        if (err != null) {
            fail();
            return;
        }

        // test result
        if (typeof row !== "undefined") {
            // WIN
            win(row.id);
        } else {
            // FAIL
            fail();
        }

    });

};

function isTrackInCrate(createId, trackId, win, fail) {
    db.get("SELECT * FROM crate_tracks WHERE crate_id=? AND track_id=?", [createId, trackId], function (err, row) {

        // in case of error
        if (err != null) {
            fail();
            return;
        }

        // test result
        if (typeof row !== "undefined") {
            // WIN
            win();
        } else {
            // FAIL
            fail();
        }

    });
};

function addTrackToCrate(crateId, trackId, win, fail) {
    var request = db.run("INSERT INTO crate_tracks ('crate_id', 'track_id') VALUES (?, ?)", [crateId, trackId], function (info) {
        if (info === null) {
            win();
        } else {
            fail(JSON.stringify(info));
        }
    });
};

function getRatingOnTrack(trackId, win, fail) {
    db.get("SELECT rating FROM library WHERE id=?", { 1: trackId }, function (err, row) {

        // in case of error
        if (err != null) {
            fail();
            return;
        }

        // test result
        if (typeof row !== "undefined") {
            // WIN
            win(row.rating);
        } else {
            // FAIL
            fail();
        }

    });
};

function setRatingOnTrack(trackId, numberOfStars, win, fail) {
    var request = db.run("UPDATE library SET rating = ? WHERE id = ?", [numberOfStars, trackId], function (info) {
        if (info === null) {
            win();
        } else {
            fail(JSON.stringify(info));
        }
    });
};

function locationToTrackId(locationId, win, fail) {
    db.get("SELECT id FROM library WHERE location=?", { 1: locationId }, function (err, row) {

        // in case of error
        if (err != null) {
            fail();
            return;
        }

        // test result
        if (typeof row !== "undefined") {
            // WIN
            win(row.id);
        } else {
            // FAIL
            fail();
        }

    });
};