Class.subclass( Page.Base, "Page.Emoji", {	
	
	onInit: function() {
		// called once at page load
		var html = '';
		this.div.html( html );
	},
	
	onActivate: function(args) {
		// page activation
		if (!this.requireLogin(args)) return true;
		
		if (!args) args = {};
		this.args = args;
		
		app.showTabBar(true);
		
		// setup upload system
		ZeroUpload.setURL( '/api/app/emoji_upload' );
		ZeroUpload.setMaxFiles( 2 );
		ZeroUpload.setMaxBytes( 100 * 1024 * 1024 ); // 100 MB
		ZeroUpload.setFileTypes( "*" );
		ZeroUpload.on('start', this.upload_start.bind(this) );
		ZeroUpload.on('complete', this.upload_complete.bind(this) );
		ZeroUpload.on('error', this.upload_error.bind(this) );
		ZeroUpload.init();
		
		var sub = args.sub || 'list';
		this['gosub_'+sub](args);
		
		return true;
	},
	
	gosub_new: function(args) {
		// create new emoji
		var html = '';
		app.setWindowTitle( "Add New Emoji" );
		
		html += this.getSidebarTabs( 'new',
			[
				['list', "Emoji List"],
				['new', "Add New Emoji"]
			]
		);
		
		html += '<div style="padding:20px;"><div class="subtitle">Add New Emoji</div></div>';
		
		html += '<div style="padding:0px 20px 50px 20px">';
		html += '<center><table style="margin:0;">';
		
		this.emoji = {
			category: 'custom'
		};
		
		html += this.get_emoji_edit_html();
		
		html += '<tr><td colspan="2" align="center">';
			html += '<div style="height:30px;"></div>';
			
			html += '<table><tr>';
				html += '<td><div class="button" style="width:120px; font-weight:normal;" onMouseUp="$P().do_cancel()">Cancel</div></td>';
				html += '<td width="50">&nbsp;</td>';
				html += '<td><div class="button" style="width:120px;" onMouseUp="$P().do_new_emoji()"><i class="fa fa-plus-circle">&nbsp;&nbsp;</i>Add Emoji</div></td>';
			html += '</tr></table>';
			
		html += '</td></tr>';
		
		html += '</table></center>';
		html += '</div>'; // table wrapper div
		
		html += '</div>'; // sidebar tabs
		
		this.div.html( html );
		
		setTimeout( function() {
			$('#fe_ee_id').focus();
		}, 1 );
	},
	
	do_cancel: function() {
		// cancel new or edit, return to list
		Nav.go('Emoji?sub=list');
	},
	
	do_new_emoji: function() {
		// create new emoji
		app.clearError();
		var emoji = this.get_emoji_form_json();
		if (!emoji) return; // error
		
		// make sure an image was selected
		var files = this.div.find('#fe_ee_image').get(0).files;
		if (!files || !files.length) return app.badField('fe_ee_image', "Please select an image to upload for the new Emoji.");
		
		this.emoji = emoji;
		
		app.showProgress( 1.0, "Creating Emoji..." );
		
		// we MUST upload the image data first, because as soon as the emoji_create API broadcasts the change, 
		// clients will preload the image.  ZU will call new_emoji_data_finish() upon completion.
		ZeroUpload.upload( this.get_all_files(), {
			session_id: app.getPref('session_id'),
			id: this.emoji.id,
			image_format: this.emoji.format
		} );
	},
	
	new_emoji_data_finish: function(resp) {
		// emoji data saved successfully
		app.api.post( 'app/emoji_create', this.emoji, this.new_emoji_finish.bind(this) );
	},
	
	new_emoji_finish: function(resp) {
		// new emoji created successfully
		app.hideProgress();
		
		Nav.go('Emoji?sub=list');
		
		setTimeout( function() {
			app.showMessage('success', "Your new Emoji was added successfully.");
		}, 150 );
	},
	
	gosub_edit: function(args) {
		// edit emoji subpage
		this.div.addClass('loading');
		app.api.post( 'app/emoji_get', { id: args.emoji }, this.receive_emoji.bind(this) );
	},
	
	receive_emoji: function(resp) {
		// edit existing emoji
		var html = '';
		this.emoji = resp.emoji;
		if (!this.emoji.category) this.emoji.category = 'custom';
		this.div.removeClass('loading');
		app.setWindowTitle( "Editing Emoji \""+this.emoji.title+"\"" );
		
		html += this.getSidebarTabs( 'edit',
			[
				['list', "Emoji List"],
				['new', "Add New Emoji"],
				['edit', "Edit Emoji"]
			]
		);
		
		html += '<div style="padding:20px;"><div class="subtitle">Editing Emoji &ldquo;' + this.emoji.title + '&rdquo;</div></div>';
		
		html += '<div style="padding:0px 20px 50px 20px">';
		html += '<center>';
		html += '<table style="margin:0;">';
		
		html += this.get_emoji_edit_html();
		
		html += '<tr><td colspan="2" align="center">';
			html += '<div style="height:30px;"></div>';
			
			html += '<table><tr>';
				html += '<td><div class="button" style="width:115px; font-weight:normal;" onMouseUp="$P().do_cancel()">Cancel</div></td>';
				html += '<td width="50">&nbsp;</td>';
				html += '<td><div class="button" style="width:115px; font-weight:normal;" onMouseUp="$P().show_delete_emoji_dialog()">Delete Emoji...</div></td>';
				html += '<td width="50">&nbsp;</td>';
				html += '<td><div class="button" style="width:115px;" onMouseUp="$P().do_save_emoji()"><i class="fa fa-floppy-o">&nbsp;&nbsp;</i>Save Changes</div></td>';
			html += '</tr></table>';
			
		html += '</td></tr>';
		
		html += '</table>';
		html += '</center>';
		html += '</div>'; // table wrapper div
		
		html += '</div>'; // sidebar tabs
		
		this.div.html( html );
		
		setTimeout( function() {
			$('#fe_ee_id').attr('disabled', true);
		}, 1 );
	},
	
	do_save_emoji: function() {
		// save changes to existing emoji
		app.clearError();
		var emoji = this.get_emoji_form_json();
		if (!emoji) return; // error
		
		this.emoji = emoji;
		
		app.showProgress( 1.0, "Saving Emoji..." );
		
		// we MUST upload the image data first, because as soon as the emoji_update API broadcasts the change, 
		// clients will preload the image.  ZU will call save_emoji_data_finish() upon completion.
		var files = this.get_all_files();
		if (files.length) {
			// need upload
			ZeroUpload.upload( files, {
				session_id: app.getPref('session_id'),
				id: this.emoji.id,
				image_format: this.emoji.format || '' // image is optional on update
			} );
		}
		else this.save_emoji_data_finish();
	},
	
	get_all_files: function() {
		// get image and/or sound files for upload
		var files = [];
		
		var image_files = this.div.find('#fe_ee_image').get(0).files;
		if (image_files && image_files.length) files.push( image_files[0] );
		
		var sound_elem = this.div.find('#fe_ee_sound').get(0);
		if (sound_elem && sound_elem.files && sound_elem.files.length) files.push( sound_elem.files[0] );
		
		return files;
	},
	
	save_emoji_data_finish: function(resp) {
		// emoji data saved successfully
		app.api.post( 'app/emoji_update', this.emoji, this.save_emoji_finish.bind(this) );
	},
	
	upload_start: function(files, userData) {
		// emoji upload has started
		Debug.trace('emoji', "Upload started");
	},
	
	upload_complete: function(response, userData) {
		// emoji upload has completed
		Debug.trace('emoji', "Upload completed: " + response.data);
		
		var data = null;
		try { data = JSON.parse( response.data ); }
		catch (err) {
			return app.doError("Image Upload Failed: JSON Parse Error: " + err);
		}
		
		if (data && (data.code != 0)) {
			return app.doError("Image Upload Failed: " + data.description);
		}
		
		if (this.args.sub == 'new') this.new_emoji_data_finish();
		else this.save_emoji_data_finish();
	},
	
	upload_error: function(type, message, userData) {
		// avatar upload error
		app.doError("Image Upload Failed: " + message);
	},
	
	save_emoji_finish: function() {
		// emoji and image(s) saved successfully
		app.hideProgress();
		
		Nav.go('Emoji?sub=edit&emoji=' + this.emoji.id, true);
		
		setTimeout( function() {
			app.showMessage('success', "The Emoji was saved successfully.");
		}, 150 );
	},
	
	show_delete_emoji_dialog: function() {
		// show dialog confirming emoji delete action
		var self = this;
		app.confirm( '<span style="color:red">Delete Emoji</span>', "Are you sure you want to delete the Emoji \"<b>"+this.emoji.title+"</b>\"?  There is no way to undo this action.", "Delete", function(result) {
			if (result) {
				app.showProgress( 1.0, "Deleting Emoji..." );
				app.api.post( 'app/emoji_delete', {
					id: self.emoji.id
				}, self.delete_finish.bind(self) );
			}
		} );
	},
	
	delete_finish: function(resp) {
		// finished deleting
		app.hideProgress();
		
		Nav.go('Emoji?sub=list', true);
		
		setTimeout( function() {
			app.showMessage('success', "The Emoji was deleted successfully.");
		}, 150 );
	},
	
	get_emoji_edit_html: function() {
		// get html for editing an emoji (or creating a new one)
		var html = '';
		var emoji = this.emoji;
		
		// id
		html += get_form_table_row( 'Emoji ID', '<input type="text" id="fe_ee_id" size="40" value="'+escape_text_field_value(emoji.id)+'" spellcheck="false"/>' );
		html += get_form_table_caption( "Enter an alphanumeric short ID for the Emoji, e.g. \"neckbeard\".  This will be the primary activator used in chat.  After creating the Emoji this cannot be changed.");
		html += get_form_table_spacer();
		
		// title
		html += get_form_table_row( 'Title', '<input type="text" id="fe_ee_title" size="40" value="'+escape_text_field_value(emoji.title)+'"/>' );
		html += get_form_table_caption( "Enter a display title for the Emoji, e.g. \"Neck Beard\".  This can be changed whenever you want, and can be used for searches.");
		html += get_form_table_spacer();
		
		// category
		var cat_items = [
			[ "people", "Smileys & People" ], 
			[ "nature", "Animals & Nature" ], 
			[ "foods", "Food & Drink" ], 
			[ "activity", "Activities" ], 
			[ "places", "Travel & Places" ], 
			[ "objects", "Objects" ], 
			[ "flags", "Flags" ], 
			[ "symbols", "Symbols" ], 
			[ "custom", "Custom" ]
		];
		html += get_form_table_row( 'Category', '<select id="fe_ee_cat">' + render_menu_options(cat_items, emoji.category) + '</select>' );
		html += get_form_table_caption( "Select a category for the Emoji to appear in.");
		html += get_form_table_spacer();
		
		// keywords
		html += get_form_table_row( 'Keywords', '<input type="text" id="fe_ee_keywords" size="40" value="'+escape_text_field_value( (emoji.keywords || []).join(', '))+'"/>' );
		html += get_form_table_caption( "Optionally enter a set of additional keywords for searching, separated by commas.");
		html += get_form_table_spacer();
		
		// upload image
		if (emoji.id) {
			var emoji_url = '/images/emoji/' + emoji.id + '.' + emoji.format;
			if (emoji.modified) emoji_url += '?mod=' + emoji.modified;
			html += get_form_table_row( 'Replace Image', 
				'<table><tr>' + 
					'<td><div class="emoji_thumb" style="background-image:url(' + emoji_url + ')"></div></td>' + 
					'<td style="padding-left:10px;"><input id="fe_ee_image" type="file" accept="image/*"></td>' + 
				'</tr></table>' 
			);
			html += get_form_table_caption( "Optionally replace the image for your custom Emoji.  For best results, make sure it is an alpha transparent PNG, 1:1 (square) aspect ratio, and at least 64x64 pixels in size.");
			html += get_form_table_spacer();
		}
		else {
			html += get_form_table_row( 'Image', '<input id="fe_ee_image" type="file" accept="image/*">' );
			html += get_form_table_caption( "Upload an image for your custom Emoji.  For best results, make sure it is an alpha transparent PNG, 1:1 (square) aspect ratio, and at least 64x64 pixels in size.");
			html += get_form_table_spacer();
		}
		
		// upload sound
		if (emoji.sound) {
			html += get_form_table_row( 'Sound', '<input id="fe_ee_delete_sound" type="checkbox"><label for="fe_ee_delete_sound">Delete Sound</label>' );
			html += get_form_table_caption( "This Emoji has a sound file attached.  Check this box to delete it when you save.");
			html += get_form_table_spacer();
		}
		else {
			html += get_form_table_row( 'Sound', '<input id="fe_ee_sound" type="file" accept="audio/mp3">' );
			html += get_form_table_caption( "Optionally attach a sound file to play every time the Emoji is used in chat.  The file must be in MP3 format.");
			html += get_form_table_spacer();
		}
		
		return html;
	},
	
	get_emoji_form_json: function() {
		// get emoji json elements from form, used for new or edit
		var emoji = {
			id: $('#fe_ee_id').val().toLowerCase().replace(/[^\w\-\+]+/g, ''),
			title: trim($('#fe_ee_title').val()),
			category: $('#fe_ee_cat').val(),
			keywords: $('#fe_ee_keywords').val().trim().split(/\,\s*/).filter( function(keyword) { return keyword.match(/\w/); } )
		};
		
		// determine emoji image format from selected file (pre-upload sniff)
		var image_files = this.div.find('#fe_ee_image').get(0).files;
		if (image_files && image_files.length) {
			var file = image_files[0];
			if (file.name.match(/\.(\w+)$/)) {
				emoji.format = RegExp.$1.toLowerCase();
			}
			else if (file.type.match(/image\/(\w+)$/)) {
				emoji.format = RegExp.$1.toLowerCase().replace(/jpeg/, 'jpg');
			}
			else {
				return app.badField('fe_ee_image', "Could not determine image format.  Please select a different image.");
			}
		}
		
		// determine if emoji has sound or not
		var sound_elem = this.div.find('#fe_ee_sound').get(0);
		if (sound_elem && sound_elem.files && sound_elem.files.length) {
			emoji.sound = 1;
		}
		else if ($('#fe_ee_delete_sound').is(':checked')) {
			emoji.delete_sound = 1;
		}
		
		if (!emoji.id) return app.badField('fe_ee_id', "Please enter an ID for the Emoji.");
		if (!emoji.title) return app.badField('fe_ee_title', "Please enter a title for the Emoji.");
		
		return emoji;
	},
	
	gosub_list: function(args) {
		// show emoji list
		app.setWindowTitle( "Emoji List" );
		this.div.addClass('loading');
		if (!args.offset) args.offset = 0;
		if (!args.limit) args.limit = 50;
		app.api.get( 'app/emoji_get_all', copy_object(args), this.receive_emoji_list.bind(this) );
	},
	
	receive_emoji_list: function(resp) {
		// receive page of emoji from server, render it
		var html = '';
		this.div.removeClass('loading');
		
		html += this.getSidebarTabs( 'list',
			[
				['list', "Emoji List"],
				['new', "Add New Emoji"]
			]
		);
		
		var cols = ['Emoji', 'ID', 'Title', 'Author', 'Created', 'Modified', 'Actions'];
		
		// html += '<div style="padding:5px 15px 15px 15px;">';
		html += '<div style="padding:20px 20px 30px 20px">';
		
		html += '<div class="subtitle">';
			html += 'Emoji List';
			html += '<div class="subtitle_widget"><span class="link" onMouseUp="$P().refresh_emoji_list()"><b>Refresh List</b></span></div>';
			html += '<div class="clear"></div>';
		html += '</div>';
		
		this.emoji_list = resp.rows;
		
		html += this.getPaginatedTable( resp, cols, 'emoji', function(emoji, idx) {
			var emoji_url = '/images/emoji/' + emoji.id + '.' + emoji.format;
			if (emoji.modified) emoji_url += '?mod=' + emoji.modified;
			var edit_link = '#Emoji?sub=edit&emoji=' + emoji.id;
			var actions = [
				'<a href="' + edit_link + '"><b>Edit</b></a>',
				'<span class="link" onMouseUp="$P().delete_emoji_from_list(' + idx + ')"><b>Delete</b></span>'
			];
			return [
				'<div class="td_big"><a href="' + edit_link + '"><img src="' + emoji_url + '" width="32" height="32" border="0"></a></div>',
				'<a href="' + edit_link + '"><code>:' + emoji.id + ':</code></a>',
				'<b>' + emoji.title + '</b>',
				emoji.username,
				get_nice_date( emoji.created ),
				get_nice_date( emoji.modified ),
				actions.join(' | ')
			];
		} ); // getPaginatedTable
		
		html += '</div>'; // padding
		html += '</div>'; // sidebar tabs
		
		this.div.html( html );
	},
	
	delete_emoji_from_list: function(idx) {
		// delete emoji using list index
		this.emoji = this.emoji_list[idx];
		this.show_delete_emoji_dialog();
	},
	
	refresh_emoji_list: function() {
		// refresh emoji list
		this.gosub_list(this.args);
	},
	
	onDeactivate: function() {
		// called when page is deactivated
		return true;
	}
	
} );
