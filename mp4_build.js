function MP4_build(vdata, adata, jBinary, MP4){
	var mp4, trak,
		creationTime = new Date(),
		audioStart = vdata.data.byteLength,
		mdat = new Uint8Array(vdata.data.byteLength + adata.data.byteLength);

	mdat.set(vdata.data);
	mdat.set(adata.data,audioStart);

	// generating resulting MP4

	mp4 = new jBinary(mdat.byteLength*2, MP4);
	
	trak = [{
		atoms: {
			tkhd: [{
				version: 0,
				flags: 15,
				track_ID: 1,
				duration: vdata.duration,
				layer: 0,
				alternate_group: 0,
				volume: 1,
				matrix: {
					a: 1, b: 0, x: 0,
					c: 0, d: 1, y: 0,
					u: 0, v: 0, w: 1
				},
				dimensions: {
					horz: vdata.width,
					vert: vdata.height
				}
			}],
			mdia: [{
				atoms: {
					mdhd: [{
						version: 0,
						flags: 0,
						timescale: 90000,
						duration: vdata.duration,
						lang: 'und'
					}],
					hdlr: [{
						version: 0,
						flags: 0,
						handler_type: 'vide',
						name: 'VideoHandler'
					}],
					minf: [{
						atoms: {
							vmhd: [{
								version: 0,
								flags: 1,
								graphicsmode: 0,
								opcolor: {r: 0, g: 0, b: 0}
							}],
							dinf: [{
								atoms: {
									dref: [{
										version: 0,
										flags: 0,
										entries: [{
											type: 'url ',
											version: 0,
											flags: 1,
											location: ''
										}]
									}]
								}
							}],
							stbl: [{
								atoms: {
									stsd: [{
										version: 0,
										flags: 0,
										entries: [{
											type: 'avc1',
											data_reference_index: 1,
											dimensions: {
												horz: vdata.width,
												vert: vdata.height
											},
											resolution: {
												horz: 72,
												vert: 72
											},
											frame_count: 1,
											compressorname: '',
											depth: 24,
											atoms: {
												avcC: [{
													version: 1,
													profileIndication: vdata.spsInfo.profile_idc,
													profileCompatibility: vdata.spsInfo.profile_compatibility,
													levelIndication: vdata.spsInfo.level_idc,
													lengthSizeMinusOne: 3,
													seqParamSets: [vdata.sps],
													pictParamSets: [vdata.pps]
												}]
											}
										}]
									}],
									stts: [{
										version: 0,
										flags: 0,
										entries: vdata.dts_diffs
									}],
									stss: [{
										version: 0,
										flags: 0,
										entries: vdata.accessIndices
									}],
									ctts: [{
										version: 0,
										flags: 0,
										entries: vdata.pd_diffs
									}],
									stsc: [{
										version: 0,
										flags: 0,
										entries: [{
											first_chunk: 1,
											samples_per_chunk: vdata.sizes.length,
											sample_description_index: 1
										}]
									}],
									stsz: [{
										version: 0,
										flags: 0,
										sample_size: 0,
										sample_count: vdata.sizes.length,
										sample_sizes: vdata.sizes
									}],
									stco: [{
										version: 0,
										flags: 0,
										entries: [0x28]
									}]
								}
							}]
						}
					}]
				}
			}]
		}
	}];

	if(adata.audioSize > 0){
		trak.push({
			atoms: {
				tkhd: [{
					version: 0,
					flags: 15,
					track_ID: 2,
					duration: vdata.duration,
					layer: 0,
					alternate_group: 1,
					volume: 1,
					matrix: {
						a: 1, b: 0, x: 0,
						c: 0, d: 1, y: 0,
						u: 0, v: 0, w: 1
					},
					dimensions: {
						horz: 0,
						vert: 0
					}
				}],
				mdia: [{
					atoms: {
						mdhd: [{
							version: 0,
							flags: 0,
							timescale: 90000,
							duration: vdata.duration,
							lang: 'eng'
						}],
						hdlr: [{
							version: 0,
							flags: 0,
							handler_type: 'soun',
							name: 'SoundHandler'
						}],
						minf: [{
							atoms: {
								smhd: [{
									version: 0,
									flags: 0,
									balance: 0
								}],
								dinf: [{
									atoms: {
										dref: [{
											version: 0,
											flags: 0,
											entries: [{
												type: 'url ',
												version: 0,
												flags: 1,
												location: ''
											}]
										}]
									}
								}],
								stbl: [{
									atoms: {
										stsd: [{
											version: 0,
											flags: 0,
											entries: [{
												type: 'mp4a',
												data_reference_index: 1,
												channelcount: 2,
												samplesize: 16,
												samplerate: 22050,
												atoms: {
													esds: [{
														version: 0,
														flags: 0,
														sections: [
															{
																descriptor_type: 3,
																ext_type: 128,
																length: 34,
																es_id: 2,
																stream_priority: 0
															},
															{
																descriptor_type: 4,
																ext_type: 128,
																length: 20,
																type: 'mpeg4_audio',
																stream_type: 'audio',
																upstream_flag: 0,
																buffer_size: 0,
																maxBitrate: Math.round(adata.maxAudioSize / (vdata.duration / 90000 / adata.audioSizes.length)),
																avgBitrate: Math.round((adata.data.byteLength) / (vdata.duration / 90000))
															},
															{
																descriptor_type: 5,
																ext_type: 128,
																length: 2,
																audio_profile: adata.profileMinusOne + 1,
																sampling_freq: adata.samplingFreq,
																channelConfig: adata.channelConfig
															},
															{
																descriptor_type: 6,
																ext_type: 128,
																length: 1,
																sl: 2
															}
														]
													}]
												}
											}]
										}],
										stts: [{
											version: 0,
											flags: 0,
											entries: [{
												sample_count: adata.audioSizes.length,
												sample_delta: Math.round(vdata.duration / adata.audioSizes.length)
											}]
										}],
										stsc: [{
											version: 0,
											flags: 0,
											entries: [{
												first_chunk: 1,
												samples_per_chunk: adata.audioSizes.length,
												sample_description_index: 1
											}]
										}],
										stsz: [{
											version: 0,
											flags: 0,
											sample_size: 0,
											sample_count: adata.audioSizes.length,
											sample_sizes: adata.audioSizes
										}],
										stco: [{
											version: 0,
											flags: 0,
											entries: [0x28 + audioStart]
										}]
									}
								}]
							}
						}]
					}
				}]
			}
		});
	}

	mp4.write('File', {
		ftyp: [{
			major_brand: 'isom',
			minor_version: 512,
			compatible_brands: ['isom', 'iso2', 'avc1', 'mp41']
		}],
		mdat: [{
			_rawData: mdat
		}],
		moov: [{
			atoms: {
				mvhd: [{
					version: 0,
					flags: 0,
					creation_time: creationTime,
					modification_time: creationTime,
					timescale: 90000,
					duration: vdata.duration,
					rate: 1,
					volume: 1,
					matrix: {
						a: 1, b: 0, x: 0,
						c: 0, d: 1, y: 0,
						u: 0, v: 0, w: 1
					},
					next_track_ID: 2
				}],
				trak: trak
			}
		}]
	});
	
	return new Blob([mp4.slice(0, mp4.tell()).view.getBytes()], {type: 'video/mp4'});
}